import { Component, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';

import { Observable } from 'rxjs/Observable';

import { ImageCropperComponent, CropperSettings } from 'ng2-img-cropper';
import { S3 } from 'aws-sdk';

import { AuthService } from '../service/auth.service';
import { AwsConfigService } from '../service/aws-config.service';
import { environment } from '../../environments/environment';
import { Group } from '../model/group';
import { GroupService } from '../service/group.service';
import { User } from '../model/user';
import { LoggerService } from '../service/logger.service';

@Component({
    selector: 'app-register-form',
    templateUrl: 'register.component.html'
})

export class RegisterComponent implements OnInit {
    user = new User('', '',
    'https://scontent-lax3-2.xx.fbcdn.net/v/t1.0-1/c0.18.144.144/1959924_10152245270295149_894823673_n.jpg?oh=62bd96d9ceacdba3940f448e1fe27479&oe=5A4E6CA3',
     '', '');
     groups: string[];
    emailPreferred = true;
    errMsg = '';
    statusMsg = '';
    imgData: any;
    file: File;
    cropperSettings: CropperSettings;
    @ViewChild('cropper', undefined) cropper: ImageCropperComponent;
    useCamera = false;
    webcam;
    camOptions: {};

    private _s3: S3;
    private _cropLRTB: string;

    constructor(
        private authService: AuthService,
        private awsConfigService: AwsConfigService,
        private groupService: GroupService,
        private logger: LoggerService,
        private router: Router
    ) {
        this.cropperSettings = new CropperSettings();
        this.cropperSettings.width = 70;
        this.cropperSettings.height = 70;
        this.cropperSettings.minWidth = 70;
        this.cropperSettings.minHeight = 70;
        this.cropperSettings.croppedWidth = 70;
        this.cropperSettings.croppedHeight = 70;
        this.cropperSettings.keepAspect = true;
        this.cropperSettings.canvasWidth = 640;
        this.cropperSettings.canvasHeight = 480;
        this.cropperSettings.noFileInput = true;
        this.imgData = {};

        this.camOptions = {
            audio: false,
            video: true,
            width: 400,
            height: 300,
            fallbackQuality: 85,
            fallbackMode: 'callback',
            fallbackSrc: 'jscam_canvas_only.swf',
            cameraType: 'front'
        };

        this.awsConfigService.getConfig()
        .then((config) => {
            this._s3 = new S3({region: config.region, credentials: config.credentials});
        })
        .catch((err) => this.logger.error('Error getting AWS config', err));
    }

    ngOnInit() {
        this.groupService.getAllGroups()
        .then((groups) => this.groups = groups.map((g) => g.name))
        .catch((e) => this.logger.error(e.message, e));
    }

    changeContactPref(someval: boolean) {
        this.emailPreferred = someval;
        // Unset the field that isn't preferred just in case
        // the user entered something in it before changing her
        // preference
        if (someval) {
            this.user.phone = '';
        } else {
            this.user.email = '';
        }
    }

    // passes the user-selected image file to the cropper
    fileChangeListener($event) {
        const image: any = new Image();
        this.file = $event.target.files[0];
        const reader: FileReader = new FileReader();
        const regComponent = this;
        reader.onloadend = function(loadEvent: any) {
            image.src = loadEvent.target.result;
            regComponent.cropper.setImage(image);
        };
        reader.readAsDataURL(this.file);
    }

    // stores the bounds of the crop rectangle for eventual upload as S3 metadata
    cropChanged($e) {
        this._cropLRTB = `${$e.left},${$e.right},${$e.top},${$e.bottom}`;
    }

    camCapture() {
        const video = <any>document.getElementsByTagName('video')[0];
        const canvas = <any>document.getElementsByTagName('canvas')[0];
        if (video) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            const reader: FileReader = new FileReader();
            const regComponent = this;
            const image: any = new Image();
            reader.onloadend = function(loadEvent: any) {
                image.src = loadEvent.target.result;
                regComponent.cropper.setImage(image);
            };
            canvas.toBlob(function(blob) {
                reader.readAsDataURL(blob);
            });
        }
    }

    onCamSuccess(event) {}

    onCamError(err) {
        this.errMsg = err.message;
        this.logger.error('Error using camera', err);
    }

    onUseCameraClick($event) {
        this.useCamera = !this.useCamera;
        if (this.useCamera) {
            $event.target.innerText = 'Hide camera';
            this.file = undefined;
        } else {
            $event.target.innerText = 'Use camera';
        }
    }

    groupSearch = (text$: Observable<string>) =>
        text$
            .debounceTime(200)
            .distinctUntilChanged()
            .map(term => term.length < 2 ? []
                : this.groups.filter(g => g.toLowerCase().indexOf(term.toLowerCase()) > -1 ))

    register(): void {
        this.statusMsg = 'Uploading cropped image...';
        const rand = Math.floor(Math.random() * 10000000);
        const fileExt = this.file === undefined ? 'png' : this.file.name.split('.').pop();
        // strip out the data-url header
        const buf = new Buffer(this.imgData.image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const key =  `medium/${rand}.${fileExt}`;
        const s3params = {
            ACL: 'public-read',
            Body: buf,
            Bucket: `${environment.usrImgBucket}`,
            Key: key
        };
        this._s3.putObject(s3params).promise()
        .then(() => {
            // set the user's photo to be the just-uploaded cropped image
            this.user.photoUrl = `https://${environment.usrImgBucket}.s3.${this._s3.config.region}.amazonaws.com/${key}`;
            // then upload the full-size photo
            this.statusMsg = 'Uploading full image...';
            const fname = this.file === undefined ? 'cam.png' : this.file.name;
            const keyFull = `full/${rand}-${fname}`;
            const body = this.file === undefined ? new Buffer(this.cropper.image.original.currentSrc.replace(/^data:image\/\w+;base64/, ''), 'base64') : this.file ;
            const s3paramsFull = {
                ACL: 'authenticated-read',
                Body: body,
                Bucket: `${environment.usrImgBucket}`,
                Key: keyFull,
                Metadata: {
                    'crop-lrtb': this._cropLRTB
                }
            };
            return this._s3.putObject(s3paramsFull).promise();
        })
        .then(() => {
            this.statusMsg = 'Registering user...';
            return this.authService.register(this.user);
        })
        .then((res) => {
            this.router.navigate(['/verify', {'username': this.user.username()}]);
        })
        .catch((err) => {
            this.statusMsg = '';
            this.errMsg = err.message;
            this.logger.error('Error registering user', err);
        });
    }
}

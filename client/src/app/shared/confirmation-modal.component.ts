import {Component, EventEmitter, Input, Output, ViewChild, TemplateRef} from '@angular/core';

import {NgbModal, NgbModalRef} from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-confirmation-modal',
  template: `
  <ng-template #content let-modal>
    <div class="modal-body">
        {{this.bodyText}}
    </div>
    <div>
        <div *ngFor="let button of this.buttons">
            <button type="button" class="btn modal-btn" (click)="close(button)">{{button}}</button>
        </div>
    </div>
  </ng-template>
  `,
  styles: ['.modal-btn { float: right; margin: 0px 8px 10px 0px; }']
})
export class ConfirmationModalComponent {
    @Input() bodyText: string;
    @Input() buttons: string[];
    @ViewChild('content') content: TemplateRef<any>;
    @Output() closed = new EventEmitter<string>();
    activeModal: NgbModalRef;

    constructor(private modalService: NgbModal) {}

    open() {
        this.activeModal = this.modalService.open(this.content, { backdrop: 'static' });
    }

    close(result: string) {
        this.activeModal.close(result);
        this.closed.emit(result);
        this.activeModal = null;
    }
}

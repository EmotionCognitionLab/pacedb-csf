export class User {
    id: string;
    groupId: string;
    isAdmin: boolean;
    givenName: string;
    familyName: string;
    email?: string;
    passwd?: string;
    phone?: string;
    fullPhotoUrl: string;
    dateCreated: Date;

    constructor(public firstName: string,
        public lastName: string,
        public photoUrl: string,
        public emailAddr?: string,
        public phoneNum?: string,
        public password?: string) {
            this.givenName = firstName;
            this.familyName = lastName;
            this.fullPhotoUrl = photoUrl;
            this.email = emailAddr;
            this.phone = phoneNum;
            this.passwd = password;
        }

    username(): string {
        return this.email === '' ? this.phone : this.email;
    }
}

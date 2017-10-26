export class User {
    id: string;
    group: string;
    isAdmin = false;
    dateCreated: Date;

    constructor(public firstName: string,
        public lastName: string,
        public photoUrl: string,
        public password: string,
        public email?: string,
        public phone?: string
        ) {}

    username(): string {
        return this.email === undefined || this.email === '' ? this.phone : this.email;
    }
}

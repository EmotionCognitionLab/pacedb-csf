import { EmojiFeedback } from './emoji-feedback';

export class User {
    id: string;
    group: string;
    isAdmin = false;
    dateCreated: Date;
    emojis: EmojiFeedback[] = [];

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

    name(): string {
        return this.firstName + ' ' + this.lastName.slice(0,1) + '.';
    }
}

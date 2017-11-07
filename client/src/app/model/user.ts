import { EmojiFeedback } from './emoji-feedback';

export class User {
    id: string;
    group: string;
    isAdmin = false;
    dateCreated: Date;
    emojis: EmojiFeedback[] = [];

    static fromJsonString(json: string): User {
        const jsObj = JSON.parse(json);
        return User.fromJsonObj(jsObj);
    }

    static fromJsonObj(jsObj): User {
        const result = new User('', '', '', '');
        for (const prop in jsObj) {
            if (result.hasOwnProperty(prop)) {
                result[prop] = jsObj[prop];
            }
        }
        return result;
    }

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
        return this.firstName + ' ' + this.lastName.slice(0, 1) + '.';
    }
}

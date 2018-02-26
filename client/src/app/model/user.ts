export class User {
    id: string;
    group: string;
    isAdmin = false;
    dateCreated: number;

    static fromJsonString(json: string): User {
        const jsObj = JSON.parse(json);
        return User.fromJsonObj(jsObj);
    }

    static fromJsonObj(jsObj): User {
        const result = new User('', '', '', '', '');
        result.id = ''; // so that it will be populated from jsObj, if it's there
        result.group = ''; // ditto
        result.isAdmin = false; // ditto
        result.dateCreated = 0; // ditto
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
        public subjectId: string,
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

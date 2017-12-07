import { User } from './user';
import { Group } from './group';

export interface GroupPage {
    group: Group;
    members: User[];
}

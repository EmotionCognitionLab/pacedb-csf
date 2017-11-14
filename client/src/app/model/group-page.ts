import { User } from './user';
import { Group } from './group';
import { GroupMessage } from './group-message';

export interface GroupPage {
    group: Group;
    messages: GroupMessage[];
    members: User[];
}

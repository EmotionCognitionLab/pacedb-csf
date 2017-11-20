import * as moment from 'moment';

export class Group {
    // number of minutes per day participants should aim to practice in a given week
    // week 1 == TARGET_MINUTES[0], week 2 == TARGET_MINUTES[1], etc.
    private static TARGET_MINUTES = [10, 10, 20, 20, 30];

    // convenient alternate forms of startDate and endDate
    private _startMoment: moment.Moment;
    private _endMoment: moment.Moment;

    constructor(public name: string, public startDate: number, public endDate: number) {
        this._startMoment = moment(startDate.toString());
        this._endMoment = moment(endDate.toString());
    }

    /**
     * Returns a number from the range 0-6 representing the day of the week.
     * The week starts on startDate, so if startDate is a Wednesday calling this
     * on a Wednesday will return 0;
     */
    dayOfWeek(): number {
        const today = moment().day();
        const start = this._startMoment.day();
        return today >= start ? today - start : 7 - (start - today);
    }

    /**
     * Returns the 0-indexed number of the week the group is currently in,
     * or undefined if today's date is outside of the startDate/endDate.
     *
     * Weeks begin on the startDate, so a week might run from Wednesday-Tuesday, for example.
     */
    weekNum(): number {
        const today = moment();
        if (today.isBefore(this._startMoment) || today.isAfter(this._endMoment)) {
            return undefined;
        }

        return Math.floor(today.diff(this._startMoment, 'days') / 7);
    }

    /**
     * Returns the target number of minutes a member of this group should aim to practice
     * today, or undefined if today is outside the start/end date range.
     */
    dailyMinutesTarget(): number {
        const curWeek = this.weekNum();
        if (curWeek === undefined || curWeek > Group.TARGET_MINUTES.length - 1) {
            return undefined;
        }
        return Group.TARGET_MINUTES[curWeek];
    }
}

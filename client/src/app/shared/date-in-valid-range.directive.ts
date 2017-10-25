// Given an earliestDate and a latestDate (in any format Date.parse can handle),
// checks to see if the date entered in a given form element falls between them.
import { Input, Directive } from '@angular/core';
import { AbstractControl, Validator, ValidatorFn, NG_VALIDATORS } from '@angular/forms';

const selector = 'validDateRange';

export function dateInValidRangeValidator(earliest: Date, latest: Date): ValidatorFn {
    return (control: AbstractControl): {[key: string]: any} => {
        try {
            if (control.value === undefined || control.value === null) { return null; }
            const selectedDate =
                new Date(control.value.year, control.value.month - 1, control.value.day).valueOf();
            return selectedDate >= earliest.valueOf() &&
            selectedDate <= latest.valueOf() ? null : {selector: {value: control.value}};
        } catch (e) {
            console.log(e.message);
            return {selector: {value: control.value}};
        }
    };
}

@Directive(
    { selector: '[' + selector + ']',
    providers: [{provide: NG_VALIDATORS, useExisting: DateInValidRangeDirective, multi: true}] }
)
export class DateInValidRangeDirective implements Validator {
    @Input() earliestDate: string;
    @Input() latestDate: string;

    validate(control: AbstractControl): {[key: string]: any} {
        try {
            return this.earliestDate && this.latestDate ?
              dateInValidRangeValidator(new Date(Date.parse(this.earliestDate)),
               new Date(Date.parse(this.latestDate)))(control) : null;
        } catch (e) {
            console.log(e.message);
            // if they don't provide valid inputs, assume date is invalid
            return {selector: {value: control.value}};
        }
    }

    constructor() { }
}

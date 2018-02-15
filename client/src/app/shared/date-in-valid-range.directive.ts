// Given an earliestDate and a latestDate (in any format Date.parse can handle),
// checks to see if the date entered in a given form element falls between them.
import { Injectable, Input, Directive } from '@angular/core';
import { AbstractControl, Validator, ValidatorFn, NG_VALIDATORS } from '@angular/forms';
import { LoggerService } from '../service/logger.service';

const selector = 'validDateRange';

export function dateInValidRangeValidator(earliest: Date, latest: Date, logger: LoggerService): ValidatorFn {
    return (control: AbstractControl): {[key: string]: any} => {
        try {
            if (control.value === undefined || control.value === null) { return null; }
            const selectedDate =
                new Date(control.value.year, control.value.month - 1, control.value.day).valueOf();
            return selectedDate >= earliest.valueOf() &&
            selectedDate <= latest.valueOf() ? null : {selector: {value: control.value}};
        } catch (e) {
            logger.error(e.message, e);
            return {selector: {value: control.value}};
        }
    };
}

@Directive(
    { selector: '[' + selector + ']',
    providers: [{provide: NG_VALIDATORS, useExisting: DateInValidRangeDirective, multi: true}] }
)
@Injectable()
export class DateInValidRangeDirective implements Validator {
    @Input() earliestDate: string;
    @Input() latestDate: string;

    validate(control: AbstractControl): {[key: string]: any} {
        try {
            return this.earliestDate && this.latestDate ?
              dateInValidRangeValidator(new Date(Date.parse(this.earliestDate)),
               new Date(Date.parse(this.latestDate)), this.logger)(control) : null;
        } catch (e) {
            this.logger.error('Error validating date range input', e);
            // if they don't provide valid inputs, assume date is invalid
            return {selector: {value: control.value}};
        }
    }

    constructor(private logger: LoggerService) { }
}

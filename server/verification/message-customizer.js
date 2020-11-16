'use strict';

/**
 * Called by Cognito before a message (e.g. account verification code, password reset code)
 * is sent to a user. Currently we only customize the forgot password message here, because
 * otherwise it's identical to the account verification message, which is very confusing.
 * 
 * The account verification message is customized in the General Settings->Message customizations
 * section of the cognito user pool.
 * 
 * http://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools-working-with-aws-lambda-triggers.html#cognito-user-pools-lambda-trigger-syntax-custom-message
 **/

exports.handler = (event, context, callback) => {
    if (event.triggerSource === 'CustomMessage_ForgotPassword') {
        const code = event.request.codeParameter;
        const uname = encodeURIComponent(event.request.userAttributes.email || event.request.userAttributes.phone_number);
        const resp = {
            smsMessage: `Please go to https://brainandbreath.org/login?do=reset&u=${uname} and enter your password reset code: ${code}`,
            emailMessage: `Your brainandbreath.org password reset code is: ${code}. \n<p>Please go to https://brainandbreath.org/login?do=reset&u=${uname} to reset your password.</p><p>\n\nIf you did not request a password reset, please ignore this message.</p>`,
            emailSubject: 'Password reset request for brainandbreath.org'
        }
        event.response = resp;
     }
    context.done(null, event);
};
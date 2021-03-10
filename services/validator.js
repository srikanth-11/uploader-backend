const  validator=require('validator');

class Validator {

    isEmail(email) {
        return validator.isEmail(email);
    }
}
module.exports = Validator;

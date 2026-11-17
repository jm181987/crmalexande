import test from 'node:test';
import assert from 'node:assert/strict';
import {isValidUserEmail} from '../server/user-validation.js';
test('valid emails including letter s are accepted',()=>{
 for(const email of ['soporte@empresa.com','usuario@empresa.com.br','ventas.sur+crm@dominio.com',' TEST@EXAMPLE.COM '])assert.equal(isValidUserEmail(email),true,email);
});
test('malformed emails are rejected',()=>{
 for(const email of ['','hola','usuario@','@dominio.com','usuario@dominio','usuario@@dominio.com','usuario @dominio.com','usuario@-dominio.com'])assert.equal(isValidUserEmail(email),false,email);
});

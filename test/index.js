'use strict';

var should = require('should'),
    fs = require('fs'),
    Vhttp = require('..');


before(function () {
    Vhttp.reset();
    Vhttp.configure({ root: 'test/virtual' });
    Vhttp.register({
        scenario1: {
            'call1-1': {
                method: 'get',
                uri: 'http://test.url/path'
            },
            'call2-1': {
                method: 'post',
                uri: 'http://test.url/path2'
            }
        },
        scenario2: {
            'call1-2': {
                method: 'get',
                uri: 'http://test.url/path',
                status: 400
            }
        }
    });
});

it('virtualizes get json with data', function () {
    return new Vhttp('scenario1')
        .get('http://test.url/path')
        .then(function (data) {
            data.should.eql({
                name: 'call1',
                param: 'real-param'
            });
        });
});

it('virtualizes post json without data', function () {
    return new Vhttp('scenario1')
        .post('http://test.url/path2', { body: { name: 'call2', param: 'request-param' } })
        .then(function (data) {
            data.should.eql({
                name: 'call2',
                param: 'response-param'
            });
        });
});

it('virtualizes get json with error', function () {
    return new Vhttp('scenario2')
        .get('http://test.url/path')
        .then(function (data) {
            console.log(data);
            throw new Error('Invalid data: ' + data);
        })
        .catch(function (err) {
            err.should.eql({ error: { name: 'call1', param: 'err-param' } });
        });
});

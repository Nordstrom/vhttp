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
            },
            'call3-1': {
                method: 'put',
                uri: 'http://test.url/path3'
            },
            'call4-1': {
                method: 'post',
                uri: 'http://test.url/path4'
            }
        },
        scenario2: {
            'call1-2': {
                method: 'get',
                uri: 'http://test.url/path',
                status: 400
            },
            'call3-2': {
                method: 'post',
                uri: 'http://test.url/path3',
                status: 200
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
            throw new Error('Invalid data: ' + data);
        })
        .catch(function (err) {
            err.should.eql({ error: { name: 'call1', param: 'err-param' } });
        });
});

it('virtualizes put xml with data', function () {
    return new Vhttp('scenario1')
        .put('http://test.url/path3', { body: '<request><name>call3</name><param>call3-request-param</param></request>' })
        .then(function (data) {
            data.should.eql('<response>\n    <name>call3</name>\n    <param>call3-response-param</param>\n</response>');
        });
});

it('virtualizes post json with regex', function () {
    return new Vhttp('scenario1')
        .post('http://test.url/path4', { body: { name: 'call4', param: 'call4 request param' } })
        .then(function (data) {
            data.should.eql({
                name: 'call4',
                param: 'call4-response-param'
            });
        });
});

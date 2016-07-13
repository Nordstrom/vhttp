'use strict';

var should = require('should'),
    fs = require('fs'),
    nock = require('nock'),
    Vhttp = require('..');


before(function () {
    nock.cleanAll();
    Vhttp.reset();
    Vhttp.configure({
        root: 'test/virtual',
        quiet: true
    });
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
            },
            'call5': {
                method: 'post',
                uri: 'http://test.url/path5'
            },
            'call6': {
                method: 'post',
                uri: 'http://test.url/path6'
            },
            'call7': {
                method: 'post',
                uri: 'http://test.url/path7'
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
            data.should.equal('<response>\n    <name>call3</name>\n    <param>call3-response-param</param>\n</response>');
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

it('virtualizes post xml with regex', function () {
    return new Vhttp('scenario2')
        .post('http://test.url/path3', { body: '<request><name>call3</name><param>call3 regex request param</param></request>' })
        .then(function (data) {
            data.should.equal('<response>\n    <name>call3</name>\n    <param>call3-response-param</param>\n</response>');
        });
});

it('virtualizes post json with data functions', function () {
    return new Vhttp('scenario1')
        .post('http://test.url/path5', { body: { name: 'call5', param: 'call5 request param' } })
        .then(function (data) {
            data.should.eql({
                name: 'call5',
                param: 'call5-response-param'
            })
        });
});

it('virtualizes post xml with data functions', function () {
    return new Vhttp('scenario1')
        .post('http://test.url/path7', { body: '<request><name>call7</name><param>call7 request param</param></request>' })
        .then(function (data) {
            data.should.equal('<response>\n    <name>call7</name>\n    <param>call7-response-param</param>\n</response>');
        });
});

it('virtualizes post xml with no data', function () {
    return new Vhttp('scenario1')
        .post('http://test.url/path6', { body: '<request><name>call6</name><param>call6 request param</param></request>' })
        .then(function (data) {
            data.should.equal('<response>\n    <name>call6</name>\n    <param>call6-response-param</param>\n</response>');
        });
});

it('errs on invalid scenario', function () {
    return new Vhttp('scenario0')
        .get('http://test.url/path6')
        .then(function () {
            throw new Error('Error not thrown');
        })
        .catch(function (err) {
            err.should.eql(new Error('No virtual scenario0 scenario found for GET:http://test.url/path6'));
        });
});

it('errs on invalid path', function () {
    return new Vhttp('scenario1')
        .get('http://test.url/pathX')
        .then(function () {
            throw new Error('Error not thrown');
        })
        .catch(function (err) {
            err.should.eql(new Error('No virtual scenario1 call found for GET:http://test.url/pathX'));
        });
});

it('errs on invalid body', function () {
    return new Vhttp('scenario1')
        .post('http://test.url/path6', { body: '<request><name>callX</name><param>call6 request param</param></request>' })
        .then(function () {
            throw new Error('Error not thrown');
        })
        .catch(function (err) {
            err.should.eql(new Error('No virtual scenario1 call found for POST:http://test.url/path6'));
        });
});

it('posts to real endpoint with success', function () {
    var scope = nock('http://test-real.url:80')
    // .log(console.log)
        .post('/path', { name: 'real-request' })
        .reply(200, { name: 'real-response' });

    return new Vhttp()
        .post('http://test-real.url/path', { body: { name: 'real-request' }, json: true })
        .then(function (data) {
            data.should.eql({ name: 'real-response' });
            scope.done();
        })
});

it('posts to real endpoint with error', function () {
    var scope = nock('http://test-real.url:80')
    // .log(console.log)
        .post('/path', { name: 'real-request' })
        .reply(400, { name: 'error-response' });

    return new Vhttp()
        .post('http://test-real.url/path', { body: { name: 'real-request' }, json: true })
        .then(function () {
            throw new Error('Error not thrown');
        })
        .catch(function (err) {
            err.error.should.eql({ name: 'error-response' });
            scope.done();
        })
});

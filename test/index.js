'use strict';

var should = require('should'),
    fs = require('fs'),
    Vhttp = require('..');

beforeEach(Vhttp.reset);

it('virtualizes get json with no data', function () {
    Vhttp.configure({
        root: 'test/virtual',
        scenarios: {
            scenario1: {
                'call1-1': {
                    method: 'get',
                    uri: 'http://test.url/path'
                }
            }
        }
    });

    return new Vhttp('scenario1').get('http://test.url/path')
        .then(function (data) {
            data.should.eql({
                name: 'call1',
                param: 'real-param'
            });
        });
});

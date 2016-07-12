'use strict';

var _ = require('lodash'),
    flow = require('lodash/fp/flow'),
    toPairs = require('lodash/fp/toPairs'),
    fromPairs = require('lodash/fp/fromPairs'),
    map = require('lodash/fp/map'),
    defaults = require('lodash/fp/defaults'),
    Promise = require('bluebird'),
    glob = Promise.promisify(require('glob')),
    readFile = Promise.promisify(require('fs').readFile),
    fromXml = require('xml2js').parseString,
    path = require('path'),
    sub = require('substituter'),
    eql = require('smart-eql'),
    request = require('request-promise'),
    log = {
        send: function (opts) {
            console.log('SEND%s: %s %s', opts.virtual ? ' [' + opts.virtual + ']' : '', opts.method, opts.uri)
        },
        sent: function (opts) {
            console.log('SENT%s: %s %s [%s ms]', opts.virtual ? ' [' + opts.virtual + ']' : '', opts.method, opts.uri, (Date.now() - opts.timestamp));
        },
        error: function (opts, err) {
            console.log('ERROR: %s %s [%s ms]:', opts.method, opts.uri, (Date.now() - opts.timestamp), (err.error || err));
        }
    },
    _root = path.resolve(__dirname + '/virtual'),
    _scenarios = {};

function readJson(file) {
    return readFile(file, 'utf8')
        .then(function (data) {
            return JSON.parse(data);
        });
}

function readXml(file) {
    return readFile(file, 'utf8')
        .then(function (data) {
            return fromXml(data);
        });
}

function initCall(call) {
    let key = call[0],
        value = call[1],
        parts = key.split('-'),
        name = parts[0],
        num = parts[1],

        files = glob.sync(_root + '/**/' + name + '.*'),

        request = {
            uri: value.uri,
            method: value.method
        },
        response = {
            status: value.status,
            delay: value.delay
        };

    _.forEach(files, function (file) {
        if (_.endsWith(file, '.request.json')) request.json = file;
        else if (_.endsWith(file, '.request.xml')) request.xml = file;
        else if (_.endsWith(file, '.request.tmpl.json')) request.templateJson = file;
        else if (_.endsWith(file, '.request.tmpl.xml')) request.templateXml = file;
        else if (_.endsWith(file, `.request.data.${num}.js`)) request.data = require(file);
        else if (_.endsWith(file, '.response.json')) response.json = file;
        else if (_.endsWith(file, '.response.xml')) response.xml = file;
        else if (_.endsWith(file, '.response.tmpl.json')) response.templateJson = file;
        else if (_.endsWith(file, '.response.tmpl.xml')) response.templateXml = file;
        else if (_.endsWith(file, `.response.data.${num}.js`)) response.data = require(file);
    });

    return { key: key, value: { request, response } };
}

function initScenario(scenario) {
    let key = scenario[0],
        value = scenario[1],
        calls = flow(
            toPairs,
            map(initCall)
        )(value);
    return [key, calls];
}

function renderBody(obj) {
    if (obj.json) return readJson(obj.json);

    if (obj.templateJson) {
        return readFile(obj.templateJson, 'utf8').then(function (tmpl) {
            return JSON.parse(sub(tmpl, obj.data));
        });
    }
    if (obj.xml) return readXml(obj.xml);

    if (obj.templateXml) {
        return readFile(obj.templateXml, 'utf8').then(function (tmpl) {
            return fromXml(sub(tmpl, obj.data));
        });
    }

    return Promise.resolve();
}

function render(scenario) {
    if (!scenario) return Promise.reject(new Error('No scenario'));
    return Promise.map(scenario, function (item) {
        let call = item.value;
        if (!call.request || !call.response) {
            return;
        }
        return Promise.all([
            renderBody(call.request),
            renderBody(call.response)
        ]).then(function (results) {
            return _.merge({}, item, {
                value: {
                    request: { body: results[0] },
                    response: { body: results[1] }
                }
            });
        });
    });
}

class Vhttp {
    constructor(virtual) {
        this.virtual = virtual;
    }

    send(opts) {
        opts.timestamp = Date.now();

        let self = this,
            virtual = this.virtual,
            method = opts.method.toUpperCase(),
            uri = opts.uri.toLowerCase(),
            promise = this.virtual && !this.scenario
                ? render(_scenarios[this.virtual])
                : Promise.resolve(this.scenario);

        return promise.then(function (scenario) {
            if (self.virtual && !scenario) {
                let err = new Error('No virtual ' + virtual + ' scenario found for ' + method + ':' + uri);
                log.error(opts, { error: err });
                throw err;
            }

            self.scenario = scenario;
            opts.virtual = virtual;

            log.send(opts);

            if (!scenario) {
                return request(opts)
                    .then(function (data) {
                        log.sent(opts);
                        return data;
                    });
                // .catch(function (err) {
                //     log.error(opts, err);
                //     throw (err.error || err);
                // });
            }

            let call = _.find(scenario, function (item) {
                let call = item.value,
                    req = call.request;
                if (!call._initialized) {
                    req.method = req.method.toUpperCase();
                    req.uri = req.uri.toLowerCase();
                    call._initialized = true;
                }
                if (method !== req.method) return false;
                if (uri !== req.uri) return false;
                if (!eql(opts.body, req.body)) {
                    log.error(opts, {
                        error: new Error(
                            'Bodies do not match for ' + method + ':' + uri +
                            '\nEXPECTED\n' + JSON.stringify(req.body) +
                            '\nACTUAL\n' + JSON.stringify(opts.body))
                    });
                    return false;
                }

                return true;
            });

            if (!call) {
                let err = new Error('No virtual ' + virtual + ' call found for ' + opts.method + ':' + opts.uri);
                log.error(opts, { error: err });
                throw err;
            }

            call = call.value;
            let status = call.response.status || 200,
                delay = call.response.delay || 0,
                body = call.response.body;

            console.log('status', status);
            if (!status || /^2/.test(status)) {
                return Promise
                    .delay(delay)
                    .then(function () {
                        log.sent(opts);
                        return body;
                    });
            }

            return Promise
                .delay(delay)
                .then(function () {
                    log.error(opts, { error: body });
                    return Promise.reject({ error: body });
                });
        });
    }

    static configure(opts) {
        _root = path.resolve(opts.root || _root);
        return this.register(opts.scenarios);
    }

    static register(scenarios) {
        _scenarios = flow(
            toPairs,
            map(initScenario),
            fromPairs,
            defaults(_scenarios)
        )(scenarios);
    }

    static
    reset() {
        _scenarios = {};
    }
}

_.forEach(['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'HEAD'], function (verb) {
    Vhttp.prototype[verb.toLowerCase()] = function (uri, opts) {
        return this.send(_.merge({ method: verb, uri: uri }, opts));
    }
});

module.exports = Vhttp;

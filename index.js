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
    XmlParser = require('xml2js').Parser,
    xmlParser = Promise.promisifyAll(new XmlParser({ explicitRoot: true, explicitArray: false, mergeAttrs: true })),
    fromXml = xmlParser.parseStringAsync,
    path = require('path'),
    sub = require('substituter'),
    eql = require('smart-eql'),
    request = require('request-promise'),
    _defaultLog = {
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
    _quietLog = {
        send: _.noop,
        sent: _.noop,
        error: _.noop
    },
    _log = _defaultLog,
    _root = path.resolve(__dirname + '/virtual'),
    _scenarios = {};

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
        else if (_.endsWith(file, '.request.data.js')) request.data = request.data || require(file);
        else if (_.endsWith(file, '.response.json')) response.json = file;
        else if (_.endsWith(file, '.response.xml')) response.xml = file;
        else if (_.endsWith(file, '.response.tmpl.json')) response.templateJson = file;
        else if (_.endsWith(file, '.response.tmpl.xml')) response.templateXml = file;
        else if (_.endsWith(file, `.response.data.${num}.js`)) response.data = require(file);
        else if (_.endsWith(file, '.response.data.js')) response.data = response.data || require(file);
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

function renderBody(obj, raw) {
    if (obj.json) {
        return readFile(obj.json, 'utf8')
            .then(function (data) {
                return JSON.parse(data);
            });
    }

    if (obj.templateJson) {
        return readFile(obj.templateJson, 'utf8').then(function (tmpl) {
            return sub(JSON.parse(tmpl), _.isFunction(obj.data) ? obj.data() : obj.data);
        });
    }
    if (obj.xml) {
        return readFile(obj.xml, 'utf8')
            .then(function (xml) {
                return raw ? xml.toString() : fromXml(xml);
            });
    }

    if (obj.templateXml) {
        return readFile(obj.templateXml, 'utf8').then(function (xml) {
                return raw
                    ? sub(xml, _.isFunction(obj.data) ? obj.data() : obj.data)
                    : fromXml(xml).then(function (xmlObj) {
                    return sub(xmlObj, _.isFunction(obj.data) ? obj.data() : obj.data);
                });
            }
        );
    }

    return Promise.resolve();
}

function render(scenario) {
    if (!scenario) return scenario;
    return Promise.map(scenario, function (item) {
        let call = item.value;
        return Promise.all([
            renderBody(call.request),
            renderBody(call.response, true)
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

    prepare(opts) {
        return Promise.all([
            render(_scenarios[this.virtual]),
            _.isString(opts.body)
                ? fromXml(opts.body)
                : Promise.resolve(opts.body)
        ]).then(function (results) {
            return {
                scenario: results[0],
                body: results[1]
            };
        });
    }

    send(opts) {
        opts.timestamp = Date.now();

        let self = this,
            virtual = this.virtual,
            method = opts.method.toUpperCase(),
            uri = opts.uri.toLowerCase();

        return this.prepare(opts).then(function (prepared) {
            let scenario = prepared.scenario,
                requestBody = prepared.body;

            if (self.virtual && !scenario) {
                let err = new Error('No virtual ' + virtual + ' scenario found for ' + method + ':' + uri);
                _log.error(opts, { error: err });
                throw err;
            }

            self.scenario = scenario;
            opts.virtual = virtual;

            _log.send(opts);

            if (!scenario) {
                return request(opts)
                    .then(function (data) {
                        _log.sent(opts);
                        return data;
                    })
                    .catch(function (err) {
                        _log.error(opts, err);
                        throw err;
                    });
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
                if (!eql(requestBody, req.body)) {
                    _log.error(opts, {
                        error: new Error(
                            'Bodies do not match for ' + method + ':' + uri +
                            '\nEXPECTED\n' + JSON.stringify(req.body) +
                            '\nACTUAL\n' + JSON.stringify(requestBody))
                    });
                    return false;
                }

                return true;
            });

            if (!call) {
                let err = new Error('No virtual ' + virtual + ' call found for ' + opts.method + ':' + opts.uri);
                _log.error(opts, { error: err });
                throw err;
            }

            call = call.value;
            let status = call.response.status || 200,
                delay = call.response.delay || 0,
                responseBody = call.response.body;

            if (!status || /^2/.test(status)) {
                return Promise
                    .delay(delay)
                    .then(function () {
                        _log.sent(opts);
                        return responseBody;
                    });
            }

            return Promise
                .delay(delay)
                .then(function () {
                    _log.error(opts, { error: responseBody });
                    return Promise.reject({ error: responseBody });
                });
        });
    }

    static configure(opts) {
        _root = path.resolve(opts.root || _root);
        if (opts.quiet) _log = _quietLog;
        if (opts.log) _log = _.assign({}, _defaultLog, opts.log);
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

    static reset() {
        _scenarios = {};
    }
}

_.forEach(['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'HEAD'], function (verb) {
    Vhttp.prototype[verb.toLowerCase()] = function (uri, opts) {
        return this.send(_.merge({ method: verb, uri: uri }, opts));
    }
});

module.exports = Vhttp;

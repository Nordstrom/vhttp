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
    querystring = require('querystring'),
    url = require('url'),
    sub = require('substituter'),
    eql = require('smart-eql'),
    request = require('request-promise'),
    _verboseHandlers = {
        send: function (opts) {
            console.log('SEND%s: %s %s', opts.virtual ? ' [' + opts.virtual + ']' : '', opts.method, opts.uri);
        },
        sent: function (opts) {
            console.log('SENT%s: %s %s [%s ms]', opts.virtual ? ' [' + opts.virtual + ']' : '', opts.method, opts.uri, opts.duration);
        },
        error: function (opts) {
            console.log('ERROR%s: %s %s [%s ms]:', opts.virtual ? ' [' + opts.virtual + ']' : '', opts.method, opts.uri, opts.duration, (opts.error.error || opts.error));
        },
        debug: function (opts) {
            console.log('DEBUG%s: %s %s:', opts.virtual ? ' [' + opts.virtual + ']' : '', opts.method, opts.uri, opts.message);
        }
    },
    // _eventHandlers = _verbosetHandlers,
    _root = path.resolve(__dirname + '/virtual'),
    _scenarios = {},
    _eventHandlers;

if (!RegExp.prototype.toJSON) {
    // this allows stringify to work on regular expresssions.
    // without this regular expressions are stringified to an empty object
    RegExp.prototype.toJSON = RegExp.prototype.toString;
}

function initCall(call) {
    let key = call[0],
        value = call[1],
        parts = key.split(':'),
        name = parts[0],
        num = parts[1],

        files = glob.sync(_root + '/**/' + name + '.*'),

        request = {
            uri: value.uri,
            method: value.method,
            qs: value.qs
        },
        response = {
            status: value.status,
            delay: value.delay
        };

    _.forEach(files, function (file) {
        if (_.endsWith(file, `.request.${num}.json`)) response.json = file;
        else if (_.endsWith(file, '.request.json')) request.json = file;
        else if (_.endsWith(file, '.request.xml')) request.xml = file;
        else if (_.endsWith(file, '.request.tmpl.json')) request.templateJson = file;
        else if (_.endsWith(file, '.request.tmpl.xml')) request.templateXml = file;
        else if (_.endsWith(file, `.request.data.${num}.js`)) request.data = require(file);
        else if (_.endsWith(file, '.request.data.js')) request.data = request.data || require(file);
        else if (_.endsWith(file, `.response.${num}.json`)) response.json = file;
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
            renderBody(call.response, true),
            prepareUriObj(call.request)
        ]).then(function (results) {
            return _.merge({}, item, {
                value: {
                    request: { uri: results[2].uri, qs: results[2].qs, body: results[0] },
                    response: { body: results[1] }
                }
            });
        });
    });
}

function prepareBody(opts) {
    return _.isString(opts.body)
        ? fromXml(opts.body)
        : Promise.resolve(opts.body);
}

function prepareUriObj(opts) {
    // if uri is a regexp, this will not support qs params since ? marks an optional character in regexp
    let queryIndex = opts.uri instanceof RegExp ? -1 : opts.uri.indexOf('?');
    if (queryIndex !== -1) {
        let uriQuery = querystring.parse(opts.uri.slice(queryIndex + 1));
        return Promise.resolve({
            qs: opts.qs ? _.assign(opts.qs, uriQuery) : uriQuery,
            uri: opts.uri.slice(0, queryIndex)
        });
    } else {
        return Promise.resolve({ uri: opts.uri, qs: opts.qs });
    }
}

class Vhttp {
    constructor(virtual) {
        this.virtual = virtual;
    }

    init() {
        let self = this;
        if (this.scenario) return Promise.resolve();
        return (render(_scenarios[this.virtual]) || Promise.resolve())
            .then(function (scenario) {
                self.scenario = self.scenario || scenario;
            });
    }

    _findCall(opts) {
        return _.find(this.scenario, function (item) {
            let call = item.value,
                callReq = call.request,
                qs = opts.qs,
                method = _.trim(opts.method.toUpperCase()),
                uri = _.trim(opts.uri.toLowerCase());

            if (!call._initialized) {
                callReq.method = callReq.method.toUpperCase();

                // only convert to lower if it's not a reqexp
                callReq.uri = (callReq.uri instanceof RegExp) ? callReq.uri : callReq.uri.toLowerCase();

                call._initialized = true;
            }

            let eq = [
                (method === callReq.method),
                eql(uri, callReq.uri),
                eql(qs, callReq.qs),
                eql(opts.preparedBody, callReq.body)
            ];

            opts.message = 'Matching to ' + callReq.method + ':' + callReq.uri +
                (callReq.qs ? ('?' + querystring.stringify(callReq.qs)) : '') +
                ' - method:' + eq[0] +
                '; uri:' + eq[1] +
                '; qs:' + eq[2] +
                '; body:' + eq[3];
            if (_eventHandlers && _eventHandlers.debug) {
                _eventHandlers.debug(opts);
            }

            if (eq[0] && eq[1] && !eq[2]) {
                opts.error = new Error(
                    'Query strings do not match for ' + method + ':' + uri +
                    '\nEXPECTED\n' + JSON.stringify(callReq.qs, null, 4) +
                    '\nACTUAL\n' + JSON.stringify(qs, null, 4));
                if (_eventHandlers && _eventHandlers.error) {
                    _eventHandlers.error(opts);
                }
            }
            if (eq[0] && eq[1] && !eq[3]) {
                opts.error = new Error(
                    'Bodies do not match for ' + method + ':' + uri +
                    '\nEXPECTED\n' + JSON.stringify(callReq.body, null, 4) +
                    '\nACTUAL\n' + JSON.stringify(opts.preparedBody, null, 4));
                if (_eventHandlers && _eventHandlers.error) {
                    _eventHandlers.error(opts);
                }
            }

            return eq[0] && eq[1] && eq[2] && eq[3];
        });
    }

    _sendReal(opts) {
        return request(opts)
            .then(function (data) {
                if (_eventHandlers && _eventHandlers.sent) {
                    opts.duration = Date.now() - opts.startedAt;
                    opts.responseBody = data;
                    _eventHandlers.sent(opts);
                }
                return data;
            })
            .catch(function (err) {
                if (_eventHandlers && _eventHandlers.error) {
                    opts.duration = Date.now() - opts.startedAt;
                    opts.error = err.error || err;
                    opts.statusCode = err.response && err.response.statusCode;
                    _eventHandlers.error(opts);
                }
                throw err;
            });
    }

    _sendVirtual(opts) {
        let call = this._findCall(opts);

        if (!call) {
            let err = new Error('No virtual ' + this.virtual + ' call found for ' + opts.method + ':' + opts.uri);
            if (_eventHandlers && _eventHandlers.error) {
                opts.duration = Date.now() - opts.startedAt;
                opts.error = err;
                _eventHandlers.error(opts);
            }
            return Promise.reject(err);
        }

        call._called = true;
        call = call.value;

        let status = call.response.status || 200,
            delay = call.response.delay || 0,
            responseBody = call.response.body;

        if (!status || /^2/.test(status)) {
            return Promise
                .delay(delay)
                .then(function () {
                    if (_eventHandlers && _eventHandlers.sent) {
                        opts.duration = Date.now() - opts.startedAt;
                        opts.responseBody = responseBody;
                        _eventHandlers.sent(opts);
                    }
                    return responseBody;
                });
        }

        return Promise
            .delay(delay)
            .then(function () {
                if (_eventHandlers && _eventHandlers.error) {
                    opts.duration = Date.now() - opts.startedAt;
                    opts.error = responseBody;
                    _eventHandlers.error(opts);
                }
                return Promise.reject({ error: responseBody });
            });

    }

    send(opts) {
        if (_eventHandlers) {
            opts.startedAt = Date.now();
        }

        let self = this,
            virtual = this.virtual,
            method = opts.method.toUpperCase(),
            uri = opts.uri.toLowerCase();

        return this.init()
            .then(function () {
                return Promise.join(prepareUriObj(opts), prepareBody(opts), function (uriObj, body) {
                    if (self.virtual && !self.scenario) {
                        let err = new Error('No virtual ' + virtual + ' scenario found for ' + method + ':' + uri);
                        if (_eventHandlers && _eventHandlers.error) {
                            opts.error = err;
                            _eventHandlers.error(opts);
                        }
                        throw err;
                    }

                    opts.uri = uriObj.uri;
                    opts.qs = uriObj.qs;
                    opts.preparedBody = body;
                    opts.virtual = virtual;
                    if (_eventHandlers && _eventHandlers.send) {
                        _eventHandlers.send(opts);
                    }

                    return self.scenario
                        ? self._sendVirtual(opts)
                        : self._sendReal(opts);
                });
            });
    }

    done() {
        if (!this.virtual || !this.scenario) {
            return;
        }
        var notCalled = _.filter(this.scenario, function (o) {
            return !o._called;
        });

        if (notCalled.length > 0) {
            let callErrors = _.map(notCalled, 'key');
            throw new Error('The following calls for scenario ' + this.virtual + ' were not made: ' + callErrors.join(', '));
        }
    }

    static configure(opts) {
        _root = path.resolve(opts.root || _root);
        // Use assign for _eventHandlers so that subsequent calls to config can partially override handlers
        // for instance one config may set opts.verbose = true, followed by next config includes an eventHandlers
        // that only includes an error handler.
        if (opts.verbose) _eventHandlers = _.assign(_eventHandlers, _verboseHandlers);
        if (opts.eventHandlers || opts.log) {
            _eventHandlers = _.assign(_eventHandlers, opts.log, opts.eventHandlers);
        }
        if (opts.scenarios) this.register(opts.scenarios);
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

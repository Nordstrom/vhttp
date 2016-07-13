# vhttp
[![Build Status](https://travis-ci.org/Nordstrom/vhttp.svg?branch=master)](https://travis-ci.org/Nordstrom/vhttp)

Promise based HTTP/HTTPS client with optional virtualization.  Depends on [request-promise](https://www.npmjs.com/package/request-promise).  This is helpful for services / apis that call other services / apis, but want to allow for virtualizing (stubbing) those calls in tests, CI/CD pipeline, or volume / performance testing.

## Installation
Install via npm as follows:
```
$ npm install vhttp --save
```

## Usage
The most common usage is to pass a query or post param to your api indicating virtualization similar to:
```
http://hello.world.api/sayhello?virtual=notification
```

This could then be used in the service as follows:
```javascript
var Promise = require('bluebird'),
    Vhttp = require('vhttp');

Vhttp.register({
    notification: {
        slack1: {
            method: 'post',
            uri: 'http://api.slack.com/notify'
        },
        hipchat1: {
            method: 'post',
            uri: 'http://api.hipchat.com/notify'
        }
    });
        
app.post('/sayhello', function(req, res) {
    var vhttp = new Vhttp(req.params.virtual);
    
    Promise.all([
        vhttp.post('http://api.slack.com/notify', {
            body: { message: 'Hello World!' },
            json: true
        }),
        vhttp.post('http://api.hipchat.com/notify', {
            body: { message: 'Hello World!' },
            json: true
        })
    ])
        .then(function(results) {
            res.status(200).send({
                slack: results[0],
                hipchat: results[1]
            });
        })
        .catch(function(err) {
            res.status(500).send(err);
        });
});
```

For more details on bluebird's Promise.all, check [this](http://bluebirdjs.com/docs/api/promise.all.html) out.

Then in a folder called virtual the following files would be created:
```
project\
    virtual\
        slack1.request.json     // contains: { "message": "Hello World!" }
        slack1.response.json    // contains: { "status": "ok" }
        hipchat1.request.json   // contains: { "message": "Hello Workd!" }
        hipchat1.response.json  // contains: { "status": "ok" }
```

Now when we call
```
http://hello.world.api/sayhello?virtual=notification
```

the response is
```json
{
    "slack": { "status": "ok" },
    "hipchat": { "status": "ok" }
}
``` 

For real (not virtualized) api calls just remove the virtual param
```
http://hello.world.api/sayhello
```
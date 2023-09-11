var errors  = require('./errors')
  , path = require('path')
  , request = require('request')
  , url = require('url')
  , util = require('util');

require('sugar');

module.exports = function (info) {
    var protocol = info.protocol || 'https'
      , host = info.host
      , version = info.version
      , token = info.token
      , timeout = info.timeout
      , reqOptions = info.reqOptions
      , namespace = info.namespace;

    console.log('Module Initialization with info:', info);

    var getUrl = function (object) {
        var prefix = 'api', namespaced = false;

        // Allow options to override default  API prefix.
        if (object.options && object.options.apiPrefix) {
            prefix = object.options.apiPrefix;
        }

        //Add option to override namespaces in the URI
        if (object.options && object.options.namespaced) {
            namespaced = true;
        }

        // v1beta3 and greater uses lowercase endpoints instead of
        //  camelCase and defines namespaces in the query URL.
        if ((version === 'v1beta3' || version === 'v1' || version === 'extensions/v1beta1')) {
            namespaced = true;
        }

        // Define base URL for the query.
        var query = protocol + '://' + path.join(host, prefix, version);

        // Fix query URL handling for proxy and watch endpoints.
        if (object.endpoint.match(/^proxy/)) {
            query = query + '/proxy';
            var endpoint = object.endpoint.replace('proxy/', '');
        } else if (object.endpoint.match(/^watch/)) {
            query = query + '/watch';
            var endpoint = object.endpoint.replace('watch/', '');
        } else {
            var endpoint = object.endpoint;
        }

        console.log('Endpoint decided:', endpoint);

        if ( namespaced ) {
            endpoint = endpoint.toLowerCase();
            // Never use URL namespacing for namespace or node endpoints.
            if (namespace && !endpoint.match(/^namespaces/) && !endpoint.match(/^nodes/)){
                return query + '/' + path.join('namespaces', namespace, endpoint);
            }
        }
        return query + '/' + endpoint;
    };

    var getAuthUrl = function (callback) {
        request({
            url: getUrl({endpoint: 'info'})
            , json: true
            , strictSSL: false
        }, function (err, resp, body) {
            if (err) {
                console.log('getAuthUrl request error:', err);
                return callback(err);
            }

            if (resp.statusCode !== 200) {
                console.log('getAuthUrl request not OK:', resp.statusCode);
                return callback(resp.statusCode, body);
            }

            console.log('getAuthUrl success:', body.authorization_endpoint + '/oauth/token');
            callback(null, body.authorization_endpoint + '/oauth/token');
        });
    };

    var isSuccess = function (code) {
        return (code - (code % 200)) === 200;
    };

    var makeRequest = function (object, callback) {
        var object = Object.clone(object);

        object.url = getUrl(object);

        console.log('Making request to url:', object.url);

        delete object.endpoint;
        if (!object.json) {
            object.json = true;
        }
        object.timeout = timeout;
        if (object.json) {
            if (['object', 'boolean'].none(typeof object.json)) {
                object.body = object.json;
                object.json = undefined;
            }
        }
        // Define paging options.
        if (object.page) {
            if (!object.qs) {
                object.qs = {};
            }
            object.qs.page = object.page;
            delete object.page;
        }
        if (!info.ca) {
            object.strictSSL = false;
        }
        if (info.cert) {
            object.cert = info.cert;
        }
        if (info.key) {
            object.key = info.key;
        }
        if (info.ca) {
            object.ca = info.ca;
        }

        return request(object, function (err, resp, body) {
            if (err) {
                console.log('Error during request:', err);
                return callback(err);
            }

            if (isSuccess(resp.statusCode)) {
                console.log('Request success:', body);
                return callback(null, body);
            }

            console.log('Request failure, bad status code:', resp.statusCode);
            return callback(errors.get(resp));
        });
    };

    return function (object, callback) {
        // Set request authorization token if it is defined.
        if (token) {
            object.auth = {bearer: token};
        }
        // ovverride options for this request if reqOptions exists
        if (reqOptions) {
            Object.assign(object, reqOptions);
        }
        // Fix Content-Type header for PATCH methods.
        if (object.method === 'PATCH') {
            if (!object.headers) {
                object.headers = {};
            }
            object.headers['Content-Type'] = 'application/strategic-merge-patch+json';
        }
        // Use namespace querystring for older versions of kubernetes.
        if (namespace && version.match(/v1beta(1|2)/)) {
            if (!object.qs) {
                object.qs = {};
            }
            object.qs.namespace = namespace;
        }
        return makeRequest(object, callback);
    };
};

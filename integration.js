"use strict";

const request = require("request");
const _ = require("lodash");
const config = require("./config/config");
const async = require("async");
const fs = require("fs");

let Logger;
let requestWithDefaults;

const MAX_PARALLEL_LOOKUPS = 10;

/**
 *
 * @param entities
 * @param options
 * @param cb
 */
function startup(logger) {
  let defaults = {};
  Logger = logger;

  if (
    typeof config.request.cert === "string" &&
    config.request.cert.length > 0
  ) {
    defaults.cert = fs.readFileSync(config.request.cert);
  }

  if (typeof config.request.key === "string" && config.request.key.length > 0) {
    defaults.key = fs.readFileSync(config.request.key);
  }

  if (
    typeof config.request.passphrase === "string" &&
    config.request.passphrase.length > 0
  ) {
    defaults.passphrase = config.request.passphrase;
  }

  if (typeof config.request.ca === "string" && config.request.ca.length > 0) {
    defaults.ca = fs.readFileSync(config.request.ca);
  }

  if (
    typeof config.request.proxy === "string" &&
    config.request.proxy.length > 0
  ) {
    defaults.proxy = config.request.proxy;
  }

  if (typeof config.request.rejectUnauthorized === "boolean") {
    defaults.rejectUnauthorized = config.request.rejectUnauthorized;
  }

  requestWithDefaults = request.defaults(defaults);
}

function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.debug(entities);

  entities.forEach(entity => {
    //do the lookup
    let requestOptions = {
      method: "GET",
      uri: `${options.url}/v1/search`,
      auth: {
        user: options.userName,
        pass: options.apiKey
      },
      qs: {
        text: `${entity.value}`
      },
      json: true
    };

    Logger.trace({ uri: requestOptions }, "Request URI");
    //Logger.trace({ uri: requestOptions.headers }, "Request Headers");
    //Logger.trace({ uri: requestOptions.qs }, "Request Query Parameters");

    tasks.push(function(done) {
      requestWithDefaults(requestOptions, function(error, res, body) {
        if (error) {
          return done(error);
        }

        Logger.trace(requestOptions);
        Logger.trace(
          { body: body, statusCode: res ? res.statusCode : "N/A" },
          "Result of Lookup"
        );

        let result = {};

        if (res.statusCode === 200) {
          // we got data!
          result = {
            entity: entity,
            body: body
          };
        } else if (res.statusCode === 404) {
          // no result found
          result = {
            entity: entity,
            body: null
          };
        } else if (res.statusCode === 202) {
          // no result found
          result = {
            entity: entity,
            body: null
          };
        } else if (res.statusCode === 401) {
          // no result found
          result = {
            err: 'Unauthorized',
            detail: 'Request had Authorization header but token was missing or invalid. Please ensure your API token is valid.'
          };
        } else if (res.statusCode === 403) {
          // no result found
          result = {
            err: 'Access Denied',
            detail: 'Not enough access permissions.'
          };
        } else if (res.statusCode === 404) {
          // no result found
          result = {
            err: 'Not Found',
            detail: 'Requested item doesn’t exist or not enough access permissions.'
          };
        } else if (res.statusCode === 429) {
          // no result found
          result = {
            err: 'Too Many Requests',
            detail: 'Daily number of requests exceeds limit. Check Retry-After header to get information about request delay.'
          };
        } else if (res.statusCode === 500, 502, 503, 504) {
          // no result found
          result = {
            err: 'Server Error',
            detail: 'Something went wrong on our End (Intel471 API)'
          };
        } else {
          // unexpected status code
          return done({
            err: body,
            detail: `${body.error}: ${body.message}`
          });
        }

        done(null, result);
      });
    });
  });

  async.parallelLimit(tasks, MAX_PARALLEL_LOOKUPS, (err, results) => {
    if (err) {
      Logger.error({ err: err }, "Error");
      cb(err);
      return;
    }

    results.forEach(result => {
      if (result.body === null || _isMiss(result.body)) {
        lookupResults.push({
          entity: result.entity,
          data: null
        });
      } else {
        lookupResults.push({
          entity: result.entity,
          data: {
            summary: [],
            details: result.body
          }
        });
      }
    });

    Logger.debug({ lookupResults }, "Results");
    cb(null, lookupResults);
  });
}

function _isMiss(body) {
  if (!body) {
    return true;
  }

  if (
    (Array.isArray(body.indicators) && body.indicators.length > 0) ||
    (Array.isArray(body.cveReports) && body.cveReports.length > 0) ||
    (Array.isArray(body.spotReports) && body.spotReports.length > 0) ||
    (Array.isArray(body.iocs) && body.iocs.length > 0) ||
    (Array.isArray(body.events) && body.events.length > 0) ||
    (Array.isArray(body.reports) && body.reports.length > 0) ||
    (Array.isArray(body.posts) && body.posts.length > 0) ||
    (Array.isArray(body.entities) && body.entities.length > 0) ||
    (Array.isArray(body.nidsList) && body.nids.length > 0) ||
    (Array.isArray(body.privateMessages) && body.privateMessages.length > 0) ||
    (Array.isArray(body.yaras) && body.yaras.length > 0) ||
    (Array.isArray(body.malwareReports) && body.malwareReports.length > 0) ||
    (Array.isArray(body.actors) && body.actors.length > 0)
  ) {
    return false;
  }

  return true;
}

function validateStringOption(errors, options, optionName, errMessage) {
  if (
    typeof options[optionName].value !== "string" ||
    (typeof options[optionName].value === "string" &&
      options[optionName].value.length === 0)
  ) {
    errors.push({
      key: optionName,
      message: errMessage
    });
  }
}

function validateOptions(options, callback) {
  let errors = [];

  validateStringOption(
    errors,
    options,
    "userName",
    "You must provide a valid Intel 471 Username"
  );
  validateStringOption(
    errors,
    options,
    "apiKey",
    "You must provide a valid Intel 471 API Key"
  );

  callback(null, errors);
}

module.exports = {
  doLookup: doLookup,
  startup: startup,
  validateOptions: validateOptions
};

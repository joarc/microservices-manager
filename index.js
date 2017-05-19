const cluster = require('cluster');
const express = require('express');
const bodyParser = require("body-parser");
const winston = require("winston");
const redis = require("redis");
const fs = require("fs");

const CPUs = 2;
const app = express();
const sub = redis.createClient();
const pub = redis.createClient();
const logger = winston;

app.use(bodyParser.json());

var services = {};
function loadService(key) {
  if (!fs.existsSync(__dirname+"/services/"+key)) return false;
  if (services[key] == null) services[key] = require(__dirname+"/services/"+key);
  return true;
}
function unloadService(key) {
  if (services[key] != null) delete services[key];
  return true;
}

if (cluster.isMaster) {
  for (var i = 0; i < CPUs; i++) {
    cluster.fork();
  }

  function addService(key) {
    if (!fs.existsSync(__dirname+"/services/"+key)) return false;
    if (services[key] != null) return {error: true, code: 'service_already_loaded'};
    winston.info("MSC: Service "+key+" added");
    pub.publish('addService', key);
    return loadService(key);
  }
  function removeService(key) {
    if (services[key] == null) return {error: true, code: 'service_not_loaded'};
    winston.info("MSC: Service "+key+" removed");
    pub.publish('removeService', key);
    return unloadService(key);
  }
  function reloadService(key) {
    if (services[key] == null) return {error: true, code: 'service_not_loaded'};
    var rs = removeService(key);
    var as = addService(key);
    return [rs, as];
  }
  function listServices() {
    return services;
  }

  app.get('/listServices', (req, res) => {
    return res.json(listServices());
  });
  app.get('/addService', (req, res) => {
    const body = req.query;
    return res.json({success: addService(body.key)});
  });
  app.get('/removeService', (req, res) => {
    const body = req.query;
    return res.json({success: removeService(body.key)});
  });
  app.get('/reloadService', (req, res) => {
    const body = req.query;
    return res.json({success: reloadService(body.key)});
  });

  sub.on('subscribe', function(channel, count) {
    winston.info("MSC: Subscribed to "+channel);
    if (channel == "addService") pub.publish('connected', forkId);
  });
  sub.on('unsubscribe', function(channel, count) {
    winston.info("MSC: Unsubscribed to "+channel);
  });
  sub.on('message', function(channel, message) {
    if (channel == "connected") {
      winston.info("MSC: New fork connected: "+message);
      for (var i = 0; i < Object.keys(services).length; i++) {
        winston.info("MSC: addService "+Object.keys(services)[i])
        pub.publish("addService", Object.keys(services)[i]);
      }
    }
  });
  sub.subscribe('connected');

  app.all('/api/*', (req, res) => {
    const service = req._parsedUrl.pathname.split("/")[2];
    return services[service](req, res);
  });
  app.all('/', (req, res) => {
    return res.json({fork: false, endpoints: {'/api': Object.keys(services)}});
  });

  app.listen(5000, () => {
    logger.info('MSC: Express listening on port 5000');
  });
  pub.on('connect', function() {
    logger.info('MSC: Redis Pub connected');
  });
  sub.on('connect', function() {
    logger.info('MSC: Redis Sub connected');
  });
  sub.on('error', function(err) {
    if (err) logger.error(err);
  });
} else {
  var forkApp = require('express')();
  var forkId = 'F'+process.pid+': ';

  sub.on('subscribe', function(channel, count) {
    if (channel == "addService") pub.publish('connected', forkId);
  });
  sub.on('message', function(channel, message) {
    logger.info(forkId+"Messaged received from channel "+channel+'='+message);
    if (channel == "addService") {
      loadService(message);
    } else if (channel == "removeService") {
      unloadService(message);
    }
  });
  sub.on('ready', function() {
    sub.subscribe('addService', 'removeService');
  });

  forkApp.all('/', (req, res) => {
    return res.json({fork: true, endpoints: Object.keys(services)});
  });
  forkApp.all('/*', (req, res) => {
    const service = req._parsedUrl.pathname.split("/")[1];
    if (services[service] == null) return res.json({error: true, code: 'invalid_service'});
    return services[service](req, res);
  });

  forkApp.listen(3000, function() {
    logger.info(forkId+"Express started");
  });
  sub.on('connect', function() {
    logger.info(forkId+'Redis Sub connected');
  });
  pub.on('connect', function() {
    logger.info(forkId+'Redis Pub connected');
  });
}

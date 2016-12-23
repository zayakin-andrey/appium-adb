"use strict";

var spawn = require('child_process').spawn
  , through = require('through')
  , EventEmitter = require('events').EventEmitter
  , util = require('util')
  , _ = require('underscore')
  , logger = require('./logger');

var Logcat = function (opts) {
  EventEmitter.call(this);
  this.adb = opts.adb;
  this.debug = opts.debug;
  this.debugTrace = opts.debugTrace;
  this.proc = null;
  this.onLogcatStart = null;
  this.logcatStarted = false;
  this.calledBack = false;
  this.logs = [];
  this.logsSinceLastRequest = [];
};

util.inherits(Logcat, EventEmitter);

Logcat.prototype.startCapture = function (cb) {
  this.onLogcatStart = cb;
  logger.debug("Starting logcat capture");
  // TODO: get logcat options from client
  this.proc = spawn(this.adb.path, this.adb.defaultArgs.concat(['logcat','-v','threadtime']));
  this.proc.stdout.setEncoding('utf8');
  this.proc.stderr.setEncoding('utf8');
  this.proc.on('error', function (err) {
    logger.error('Logcat capture failed: ' + err.message);
    if (!this.calledBack) {
      this.calledBack = true;
      cb(err);
    }
  }.bind(this));
  this.proc.on('exit', function (code, signal) {
    logger.debug('Logcat terminated with code ' + code + ', signal ' + signal);
    this.proc = null;
  }.bind(this));
  this.proc.stdout.pipe(through(this.onStdout.bind(this)));
  this.proc.stderr.pipe(through(this.onStderr.bind(this)));
};

Logcat.prototype.stopCapture = function (cb) {
  logger.debug("Stopping logcat capture");
  if (this.proc === null) {
    logger.debug("Logcat already stopped");
    cb();
    return;
  }
  this.proc.on('exit', function () {
    cb();
  });
  this.proc.kill();
  this.proc = null;
};

Logcat.prototype.onStdout = function (data) {
  this.onOutput(data, '');
};

Logcat.prototype.onStderr = function (data) {
  if (/execvp\(\)/.test(data)) {
    logger.error('Logcat process failed to start');
    if (!this.calledBack) {
      this.calledBack = true;
      this.onLogcatStart(new Error("Logcat process failed to start"));
      return;
    }
  }
  this.onOutput(data, ' STDERR');
};

Logcat.prototype.onOutput = function (data, prefix) {
  if (!this.logcatStarted) {
    this.logcatStarted = true;
    if (!this.calledBack) {
      this.calledBack = true;
      this.onLogcatStart();
    }
  }
  data = data.trim();
  data = data.replace(/\r\n/g, "\n");
  var logs = data.split("\n");
  _.each(logs, function (log) {
    log = log.trim();
    if (log) {
      var logObj = {
        timestamp: Date.now()
      , level: 'ALL'
      , message: log
      };
      this.logsSinceLastRequest.push(logObj);
      this.emit('log', logObj);
      var isTrace = /W\/Trace/.test(data);
      if (this.debug && (!isTrace || this.debugTrace)) {
        logger.debug('[LOGCAT' + prefix + '] ' + log);
      }
    }
  }.bind(this));
};

Logcat.prototype.getLogs = function () {
  var ret = this.logsSinceLastRequest;
  this.logsSinceLastRequest = [];
  return ret;
};

Logcat.prototype.getLogsIteratively = function (messageLimit, textBodyLimit) {
  var current = this.logsSinceLastRequest;
  var len = current.length;
  if (messageLimit && len > messageLimit) {
    len = messageLimit;
  }
  if (textBodyLimit && len > 0) {
    var charSum = 0;
    for (var pos = 0; pos < len; pos++) {
      charSum += current[pos].message.length;
      if (charSum > textBodyLimit) {
        break;
      }
    }
    if (pos == 0) {
      pos = 1;
    }
    len = pos;
  }
  var ret = current.splice(0, len);
  var rest = current.splice(len, current.length);
  this.logsSinceLastRequest = rest;
  return ret;
};

Logcat.prototype.getAllLogs = function () {
  return this.logs;
};

module.exports = function (opts) {
  return new Logcat(opts);
};

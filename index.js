var memwatch = require('memwatch');
var winston  = require('winston');
var _        = require('lodash');
var heapdump = require('heapdump');

var allocations = {};
var snoitacolla = {};

function updateHeapDiff(diff, logger) {
  var oldValue;
  var newValue;
  diff.change.details.forEach(function(data) {
    if (allocations[data.what] !== undefined) {
      oldValue = allocations[data.what];
      snoitacolla[oldValue].pop(snoitacolla[oldValue].indexOf(oldValue));
      if (!snoitacolla[oldValue].length) {
        delete snoitacolla[oldValue];
      }
    } else {
      oldValue = 0;
    }
    newValue = oldValue + data["+"] - data["-"];
    allocations[data.what] = newValue;
    if (!snoitacolla[newValue]) snoitacolla[newValue] = [];
    snoitacolla[newValue].push(data.what);
  });
  logger(' >>>>>>>>>> heap diff', allocations);
}

function topHeapAllocations(howMany) {
  howMany = howMany || 6;
  var result = [];
  // annoyingly, we have to convert the keys to integers first
  var keys = [];
  Object.keys(snoitacolla).forEach(function(key) { keys.push(parseInt(key, 10)); });
  // sort greatest to least
  keys.sort(function(a,b) {return b-a;});

  keys.slice(0, howMany).forEach(function(key) {
    result.push([key, snoitacolla[key]]);
  });
  return result;
}

var MemLogger = function MemLogger(options) {
  var _options = {};
  if (!options.componentName) {
    throw new Error('MemLogger should have a componentName option');
  }
  _options.logger = new(winston.Logger)({
    transports: [
      new(winston.transports.Console)()
    ]
  });
  _options.logfileRoot = '/var/log/node/';
  _options.doMemoryStats = true;
  _options.hdInterval = 1000 * 60 * 15;
  this._options = _.assign(_options, options);
  this._options.logfilename = {
    'leak': this._options.logfileRoot + this._options.componentName + '-mLeak.log',
    'stats': this._options.logfileRoot + this._options.componentName + '-mStats.log'
  }
}

MemLogger.prototype.init = function() {
  var self = this;
  self.hd = new memwatch.HeapDiff();
  self.lastHD = Date.now();
  var memLeakLogger = new(winston.Logger)({
    transports: [
      new(winston.transports.File)({
        filename: this._options.logfilename.leak
      })
    ]
  });
  
  memwatch.on('leak', function(info) {
    self._options.logger.error(' >>>>>>>>>> MEMORY LEAK DETECTED', info);
    memLeakLogger.error(info);
    updateHeapDiff(self.hd.end(), self._options.logger.error);
    self.hd = new memwatch.HeapDiff();
    self.lastHD = Date.now();
    self.tha = topHeapAllocations(10);
    self._options.logger.info(' >>>>>>>>>> top 10 heap allocations', self.tha );
    memLeakLogger.info(' >>>>>>>>>> top 10 heap allocations', self.tha ); 
  });
  
  if (self._options.doMemoryStats) {
    var memStatsLogger = new(winston.Logger)({
      transports: [
        new(winston.transports.File)({
          filename: this._options.logfilename.stats
        })
      ]
    });
    memwatch.on('stats', function(stats) {

      if (stats.type === 'inc') {
        self._options.logger.info(' >>>>>>>>>> post incremental gc sample', stats);
        memStatsLogger.info(' >>>>>>>>>> post incremental gc sample', stats);
      } else {
        if ((Date.now() - self.lastHD) > self._options.hdInterval) {
          updateHeapDiff(self.hd.end(), self._options.logger.info);
          self.hd = new memwatch.HeapDiff();
          self.lastHD = Date.now();
          self.tha = topHeapAllocations(10);
          self._options.logger.info(' >>>>>>>>>> heap allocations', self.tha );
          memStatsLogger.info(' >>>>>>>>>> heap allocations', self.tha );          
        }
        self._options.logger.info(' >>>>>>>>>> post full gc', stats );
        memStatsLogger.info(' >>>>>>>>>> post full gc', stats );    
      }      
    });
  }
}
module.exports = MemLogger;
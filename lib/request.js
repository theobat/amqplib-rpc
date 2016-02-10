var assertArgs = require('assert-args')
var maybe = require('call-me-maybe')
var castBuffer = require('cast-buffer')
var clone = require('101/clone')
var defaults = require('101/defaults')

var replyPromise = require('./reply-promise.js')

var isConnection = function (conn) {
  if (!conn || !conn.createChannel) {
    throw TypeError('"connection" must be an amqplib connection: http://www.squaremobius.net/amqp.node/channel_api.html#connect')
  }
}
var exitHandler = function () {
  this.__closed = true
}

/**
  * Make an rpc request, publish a message to an rpc queue
  * Automatically creates a channel, queue, correlationId, and sets up `properties.replyTo` and `properties.correlationId`
  * @param  {AmqplibConnection}   connection     rabbitmq connection
  * @param  {String}   queue     name of rpc-queue to send the message to
  * @param  {Buffer}   content   message content
  * @param  {Object}   [opts]  sendToQueue options
  * @param  {Object}   [opts.sendOpts]  sendToQueue options
  * @param  {Object}   [opts.queueOpts] assertQueue options for replyTo queue, queueOpts.exclusive defaults to true
  * @param  {Object}   [opts.consumeOpts] consume options for replyTo queue, consumeOpts defaults to true
  * @param  {Function} [cb] optional, only for callback api
  * @return {Promise}  returns a promise, only if using promise api
  */
module.exports = request

function request (connection, queueName, content, opts, cb) {
  var args = assertArgs(arguments, {
    'connection': isConnection,
    'queueName': 'string',
    'content': ['object', 'array', 'string', 'number', Buffer],
    '[opts]': 'object',
    '[cb]': 'function'
  })
  defaults(args, {
    opts: {}
  })
  args.opts = clone(args.opts)
  assertArgs([
    args.opts.sendOpts,
    args.opts.queueOpts,
    args.opts.consumeOpts
  ], {
    '[opts.sendOpts]': 'object',
    '[opts.queueOpts]': 'object',
    '[opts.consumeOpts]': 'object'
  })
  defaults(args.opts, {
    sendOpts: {},
    queueOpts: {},
    consumeOpts: {}
  })
  queueName = args.queueName
  content = castBuffer(args.content)
  opts = args.opts
  cb = args.cb
  defaults(opts.queueOpts, { exclusive: true }) // default exclusive queue. scopes queue to the connection
  defaults(opts.consumeOpts, { noAck: true }) // default no ack required for replyTo

  var sendOpts = opts.sendOpts
  var queueOpts = opts.queueOpts
  var consumeOpts = opts.consumeOpts

  var promise = connection.createChannel()
    .then(function (channel) {
      channel.once('exit', exitHandler)
      // create a queue w/ a random name
      return channel.assertQueue('', queueOpts)
        .then(function (replyQueue) {
          var promise = replyPromise(channel, replyQueue.queue, consumeOpts)
          channel.sendToQueue(queueName, content, sendOpts)
          return promise
        })
        .catch(function (err) {
          if (!channel.__closed) {
            return channel.close()
              .then(function () {
                throw err
              })
          }
          throw err
        })
    })
  // promise or callback
  return maybe(cb, promise)
}
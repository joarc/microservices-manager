const redis = require("redis");
const winston = require("winston");

const client = redis.createClient();

module.exports = function(req, res) {
  const body = req.query;
  if (body.id == null) {
    client.get("users/*", function(err, reply) {
      if (err) winston.error(err);
      return res.json(reply);
    });
  } else {
    client.get("users/"+body.id, function(err, reply) {
      if (err) winston.error(err);
      return res.json(reply);
    });
  }
}

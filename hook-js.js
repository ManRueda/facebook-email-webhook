'use strict'
const streamPromise = require('stream-to-promise')
const emailRegex = /[a-zA-Z0-9_\-\.]+\s?@\s?[a-z0-9-]+\s?(\.\s?[a-zA-Z0-9-]+\s?)*(\.\s?[a-zA-Z]{2,3})/i
const MongoClient = require('mongodb').MongoClient

module.exports = (ctx, req, res) => {
  if (ctx.data && ctx.data['hub.mode'] === 'subscribe') {
    if (ctx.secrets.facebook === ctx.data['hub.verify_token']) {
      res.writeHead(200, {'Content-Type': 'text/plain'})
      res.end(ctx.data['hub.challenge'])
      return
    }
  } else if (req.method === 'POST') {
    streamPromise(req).then(body => {
      body = JSON.parse(body)
      if (!body || typeof body !== 'object') {
        throw new Error('Unexpected web hook payload.')
      }
      return body
    }).then(body => {
      if (body.object === 'page') {
        return body.entry.map(e =>
          e.changes.map(c =>
            ({item: c.value.item, verb: c.value.verb, message: c.value.message, post_id: c.value.post_id, comment_id: c.value.comment_id})
          )
        ).reduce((flat, toFlat) => flat.concat(toFlat), [])
      } else {
        console.log('Not page event: ', body)
      }
    }).then(changes => {
      return Promise.all([connectDb(ctx.secrets.MONGO_URL), changes])
    }).then(opts => {
      let db = opts[0]
      let changes = opts[1]
      changes.filter(change => change.item === 'comment' && change.verb === 'add')
      .forEach(change => {
        let emailOnMessage = change.message.match(emailRegex)
        if (emailOnMessage) {
          let emailAddress = emailOnMessage[0].toLocaleLowerCase().split(' ').join('')
          var link = `https://www.facebook.com/buenosaireschat/posts/${pureId(change.post_id)}?comment_id=${pureId(change.comment_id)}`
          saveEmail(emailAddress, link, db).then(() => {
            console.log(`new email: "${emailAddress}" on ${link}`)
            returnOk()
          })
        }
      })
    }).catch(returnError)
  } else {
    returnOk()
  }

  function returnOk () {
    res.writeHead(200, {'Content-Type': 'text/plain'})
    res.end('')
  }

  function returnError (err) {
    console.log(err)
    res.writeHead(500, {'Content-Type': 'application/json'})
    res.end(JSON.stringify(err))
  }
}

function pureId (id) {
  return id.split('_')[1]
}

function connectDb (url) {
  return new Promise((resolve, reject) => {
    MongoClient.connect(url, (err, db) => {
      if (err) {
        return reject(err)
      }
      resolve(db)
    })
  })
}

function saveEmail (email, link, db) {
  return new Promise((resolve, reject) => {
    db.collection('emails').insert({email: email, date: new Date(), link: link}, err => {
      if (err) {
        return reject(err)
      }
      resolve()
    })
  })
}

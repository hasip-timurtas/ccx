const firebase = require('firebase-admin');
const serviceAccount = require("../firebase.json")
const Ortak = require('./ortak')
firebase.initializeApp({
    credential: firebase.credential.cert(serviceAccount),
    databaseURL: "https://firem-b3432.firebaseio.com"
});
const db = firebase.database();

async function Basla(){
    const ortak = new Ortak()
    let openOrders = await db.ref(`okex/abdullati56-history`).once('value').then(e => e.val())
    var abc = 1
}

Basla()
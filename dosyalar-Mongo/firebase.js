const firebase = require('firebase');
require('firebase/firestore');

const config = {
    apiKey: "AIzaSyDxDY2_n2XA4mF3RWTFXRuu0XrLCkYYG4s",
    authDomain: "firem-b3432.firebaseapp.com",
    databaseURL: "https://firem-b3432.firebaseio.com",
    projectId: "firem-b3432",
    storageBucket: "firem-b3432.appspot.com",
    messagingSenderId: "866789153670"
};

if (!firebase.apps.length) {
  firebase.initializeApp(config);
}



const db = firebase.database();
const dbf = firebase.firestore();
const auth = firebase.auth();

async function GetNotes(callback){
  db.ref('Notes').child(auth.currentUser.uid).on('value', snapshot => {
    let data = snapshot.val()
    data = data ? Object.keys(data).map(e=> ({ ...data[e], fbId: e}) ).sort((a,b)=> new Date(b.date) - new Date(a.date)) : []
    callback(data)
  })
}




module.exports =  {
  db,
  dbf,
  auth,
  GetNotes
}; 

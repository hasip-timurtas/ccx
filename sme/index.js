const Instagram = require('instagram-web-api')
const rp = require('request-promise')
const randomWords = require('random-words')
const FileCookieStore = require('tough-cookie-filestore2')
const cookieStore = new FileCookieStore('./cookies.json')



class IgAutoUpload {
    async Basla(){
        while(true){
            const client = new Instagram({ username: 'sosyal.bayii', password: 'karina3434+', cookieStore  })
            await client.login()
            const profile = await client.getProfile()
            console.log(profile.email);
            
            const hashTags = await this.GetHashTags()
            const randomNumber = Math.floor(Math.random() * 6) + 1 // 1-6 arası random sayı
            const photo = `http://keskinmedia.com/ig/${randomNumber}.jpg`
            const caption = 'DM US FOR MORE INFORMATION! ' + hashTags
            const result = await client.uploadPhoto({ photo, caption })
            var a = 1
            await this.sleep(60 * 60 * 3) // 3 saatte bir 
        }
        
    }

    async GetHashTags(){
        const word = randomWords()
        const url = 'https://query.displaypurposes.com/tag/'+ word

        const result = await rp(url).then(e=> JSON.parse(e)).catch(e=> console.log(e))
        if(result.results.length < 10 ){
            return this.GetHashTags()
        }
        const hastaghs = result.results.map(e=> "#"+e.tag).join(' ')
        return hastaghs
    }

    sleep (saniye) {
		return new Promise(resolve => setTimeout(resolve, saniye * 1000))
    }

}

const igAutoUpload = new IgAutoUpload()
igAutoUpload.Basla() 
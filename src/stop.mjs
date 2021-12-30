import Nedb from 'nedb-promise'
import { readFileSync } from 'fs'

const db = new Nedb({
  filename: process.env.DATABASE || 'data',
  autoload: true,
})

const stopwords = readFileSync(process.env.STOPWORDS || 'data.stop').toString().split('\n').map(x => x.trim()).filter(Boolean)

const posts = await db.find({})
console.log(posts.filter(({ content }) => stopwords.some(word => content.includes(word))).map(x => [ ...stopwords.filter(word => x.content.includes(word)), x.content ]).join('\n'))

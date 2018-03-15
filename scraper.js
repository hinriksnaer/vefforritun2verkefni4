require('dotenv').config();
require('isomorphic-fetch');
const cheerio = require('cheerio');

const redis = require('redis');
const util = require('util');

const redisOptions = {
  url: 'redis://127.0.0.1:6379/0',
};

const client = redis.createClient(redisOptions);

const asyncGet = util.promisify(client.get).bind(client);
const asyncSet = util.promisify(client.set).bind(client);

/**
 * Listi af sviðum með „slug“ fyrir vefþjónustu og viðbættum upplýsingum til
 * að geta sótt gögn.
 */
const departments = [
  {
    name: 'Félagsvísindasvið',
    slug: 'felagsvisindasvid',
  },
  {
    name: 'Heilbrigðisvísindasvið',
    slug: 'heilbrigdisvisindasvid',
  },
  {
    name: 'Hugvísindasvið',
    slug: 'hugvisindasvid',
  },
  {
    name: 'Menntavísindasvið',
    slug: 'menntavisindasvid',
  },
  {
    name: 'Verkfræði- og náttúruvísindasvið',
    slug: 'verkfraedi-og-natturuvisindasvid',
  },
];


async function getTestData(department) {
  const get = await asyncGet(department);
  return get;
}

async function setTestData(department, data) {
  const set = await asyncSet(department, JSON.stringify(data), 'EX', 600);
  return set;
}

async function getStatsData() {
  const get = await asyncGet('stats');
  return get;
}

async function setStatsData(data) {
  const set = await asyncSet('stats', JSON.stringify(data), 'EX', 600);
  return set;
}

function createDepartmentObject(heading) {
  return {
    heading,
    tests: [],
  };
}

/**
 * Sækir svið eftir `slug`. Fáum gögn annaðhvort beint frá vef eða úr cache.
 *
 * @param {string} slug - Slug fyrir svið sem skal sækja
 * @returns {Promise} Promise sem mun innihalda gögn fyrir svið eða null ef það finnst ekki
 */

async function getTests(slug) {
  let departmentNo = null;
  let returnList = [];
  const cachedData = await getTestData(slug);
  for (let i = 0; i < departments.length; i++) { // eslint-disable-line
    if (slug === departments[i].slug) {
      departmentNo = i + 1;
      break;
    }
  }

  if (!departmentNo) return null;

  if (!cachedData) {
    const response = await fetch(`https://ugla.hi.is/Proftafla/View/ajax.php?sid=2027&a=getProfSvids&proftaflaID=37&svidID=${departmentNo}&notaVinnuToflu=0`);
    const text = await response.text();
    const $ = cheerio.load(JSON.parse(text).html);
    const fields = $('.box h3');
    const tables = $('.table-bordered');

    tables.each((i) => {
      const testData = $(tables.eq(i)).find('tr td');
      returnList.push(createDepartmentObject(fields.eq(i).text().trim()));
      testData.each((j) => {
        if (j % 5 === 0) {
          returnList[i].tests.push({
            course: testData.eq(j).text(),
            name: testData.eq(j + 1).text(),
            type: testData.eq(j + 2).text(),
            students: testData.eq(j + 3).text(),
            date: testData.eq(j + 4).text(),
          });
        }
      });
    });
    setTestData(slug, returnList);
  } else {
    returnList = JSON.parse(cachedData);
  }
  return returnList;
}

/**
 * Hreinsar cache.
 *
 * @returns {Promise} Promise sem mun innihalda boolean um hvort cache hafi verið hreinsað eða ekki.
 */
async function clearCache() {
  return client.flushall();
}

/**
 * Sækir tölfræði fyrir öll próf allra deilda allra sviða.
 *
 * @returns {Promise} Promise sem mun innihalda object með tölfræði um próf
 */
async function getStats() {
  const studentList = [];
  const statsData = await getStatsData();
  let stats;
  if (statsData) {
    stats = JSON.parse(statsData);
  } else {
    const response = await fetch('https://ugla.hi.is/Proftafla/View/ajax.php?sid=2027&a=getProfSvids&proftaflaID=37&svidID=0&notaVinnuToflu=0');
    const text = await response.text();
    const $ = cheerio.load(JSON.parse(text).html);

    const tables = $('.table-bordered');
    tables.each((i) => {
      const testData = $(tables.eq(i)).find('tr td');
      testData.each((j) => {
        if (j % 5 === 3) {
          studentList.push(testData.eq(j).text());
        }
      });
    });

    const totalStudents = studentList.reduce((x, y) => parseInt(x, 10) + parseInt(y, 10));

    stats = {
      min: Math.min(...studentList),
      max: Math.max(...studentList),
      fjoldiNema: totalStudents,
      fjoldiProfa: studentList.length,
      avgNemi: (totalStudents / studentList.length).toFixed(2),
    };
    setStatsData(stats);
  }
  return stats;
}

module.exports = {
  departments,
  getTests,
  clearCache,
  getStats,
};

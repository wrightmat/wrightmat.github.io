#!/usr/bin/env python
# coding: utf-8
# Based on: https://github.com/GiorgosXou/untappdscr

import os
import re
import json
import requests
import urllib
from dateutil import parser
from bs4 import BeautifulSoup

def __int1  (str_num:str):
    str_num = str_num.strip().replace(',', '')
    if not str_num[-1:].isdecimal(): # extreme senario but ...
        str_num = str_num.replace('+','') 
        if str_num.endswith('M'):
            str_num = float(str_num[0:-1]) * 1000000    # /topplinggoliathbrewing
        elif str_num.endswith('B'): # THIS IS JUST A GUESS
            str_num = float(str_num[0:-1]) * 1000000000
    return int(str_num)

def __float1 (str_num:str):
    return None if not str_num[-1:].isdecimal() else float(str_num)


def get_beer (_id):
    r = requests.get('https://untappd.com/beer/' + str(_id), headers = {'User-agent': 'your bot 0.1'})
    html_doc = BeautifulSoup(r.content, 'html.parser')
    url = r.url

    beer_item    = html_doc .find('div', {'class': 'content'                   })
    stats        = html_doc .find('div', {'class': 'stats'                     }).findAll('span', {'class': 'count'})
    brewery      = beer_item.find('p'  , {'class': 'brewery'                   }).find('a')
    description  = beer_item.find('div', {'class': 'beer-descrption-read-more' })
    details      = beer_item.find('div', {'class': 'details'                   })
    image        = beer_item.find('a',   {'class': 'image-big'                 })

    stats_array = []
    for s in stats:
        if s.find('a'):
            stat = __int1(s.find('a').next)
        else:
            stat = __int1(s.next)
        stats_array.append(stat)

    beer_dict = {
        'id'          : _id,
        'name'        : beer_item.find('h1').next,
        'brewery'     : brewery.next,
        'description' : description.contents[0].replace('\n',''),
        'ratings'     : int(details.find('p', {'class', 'raters'}).next.strip().split(' ')[0].strip().replace(',','')),
        'rating'      : float(beer_item.find('div', {'class': 'caps'  }).attrs['data-rating']),
        'style'       : beer_item.find('p', {'class', 'style'}).next,
        'IBU'         : __int1(details.find('p', {'class', 'ibu'}).next.strip().split(' ')[0].strip()),
        'ABV'         : __float1(details.find('p', {'class', 'abv'}).next.strip().split('%')[0].strip()),
        'image'       : image.find('img').attrs['src'],
        'stats'       : stats_array,
        'url'         : url
    }

    return json.dumps(beer_dict, default=str)


def get_venue (_id):
    r = requests.get('https://untappd.com/venue/' + str(_id), headers = {'User-agent': 'your bot 0.1'})
    html_doc = BeautifulSoup(r.content, 'html.parser')
    url = r.url  # save this for later because we were re-directed and need the new url
    if r.status_code != 200:
        return r.status_code

    header_details      = html_doc      .find('div', {'class': 'header-details'}) 
    tmp1                = header_details.find('div', {'class': 'logo'          })
    venue_name_category = header_details.find('div', {'class': 'venue-name'    })
    tmp_address         = header_details.find('p'  , {'class': 'address'       })
    map_url             = tmp_address   .find('a'  , {'class': 'track-click'   })
    info                = header_details.find('p'  , {'class': 'info'          })
    phone               = header_details.find('p'  , {'class': 'phone'         })
    stats               = html_doc      .find('div', {'class': 'stats'         }).find('ul').findAll('li')
    beers               = html_doc      .find_all('div', {'class': 'beer-details' })
    updated             = html_doc      .find('span', {'class': 'updated-time' })
    if updated:
        updated = updated.attrs['data-time']
        updated = parser.parse(updated)

    stats_array = []
    for s in stats:
        if s.find('a'):
            stat = __int1(s.find('a').next)
        else:
            stat = __int1(s.next)
        stats_array.append(stat)

    beers_array = []
    for b in beers:
        beer_link = b.find('a', {'class': 'track-click', 'data-href': ':'})
        if beer_link:
                beer_brewery = b.find('a', {'class': 'track-click', 'data-href': ':brewery'})
                beer_id = beer_link['href'].rsplit('/', 1)[-1]
                beer = {}
                beer['id'] = beer_id
                beer['datetime'] = updated
                # remove any numbers and periods in front, and clean up the beer name.
                beer['name'] = re.sub('^(\d+)\.', '', beer_link.contents[0].strip(' ').replace('\n','')).strip(' ')
                beer['brewery'] = beer_brewery.contents[0].strip(' ').replace('\n','')
                beer["venue"] = _id
                beers_array.append(beer)

    venue_dict = {
        'id'          : _id,
        'name'        : venue_name_category.find('h1').next,
        'category'    : venue_name_category.find('h2').next,
        'is_verified' : True if tmp1.find('span') else False,
        'address_name': tmp_address.next.strip(),
        'map_url'     : map_url.attrs['href'] if map_url else None,
        'phone'       : phone.next            if phone   else None,
        'info'        : info .next            if info    else None,
        'image'        : tmp1.find('img').attrs['src'],
        'stats'       : stats_array,
        'beers'       : beers_array,
        'url'         : url
    }

    # second request to get the recent activity at the venue
    r = requests.get(url + '/activity', headers = {'User-agent': 'your bot 0.1'})
    html_doc = BeautifulSoup(r.content, 'html.parser')

    beers = html_doc.find_all('div', {'class': 'checkin' })
    beers_array = []
    for b in beers:
        beer_link = b.find('a', {'class': 'label'})
        beer_id = beer_link['href'].rsplit('/', 1)[-1]
        beer_text = b.find('p', {'class': 'text'}).find_all('a')
        beer_datetime = b.find('div', {'class': 'bottom'}).find('a', {'data-href': ':feed/viewcheckindate'}).contents[0]
        beer_datetime = parser.parse(beer_datetime)
        beer = {}
        beer['id'] = beer_id
        beer['datetime'] = beer_datetime
        beer['name'] = beer_text[1].contents[0]
        beer['brewery'] = beer_text[2].contents[0]
        beer['venue'] = _id
        beers_array.append(beer)

    venue_dict['activity'] = beers_array

    return json.dumps(venue_dict, default=str)

if 'QUERY_STRING' in os.environ.keys():
    params = urllib.parse.parse_qs(os.environ['QUERY_STRING'])
    if 'venue' in params.keys():
        id = params['venue'][0]
        print(get_venue(id))
    elif 'beer' in params.keys():
        id = params['beer'][0]
        print(get_beer(id))

#location [[Necluda Region]]

East Necluda is a region of Necluda, extending into Faron and Lanayru.

### Locations

* [[Hateno Town]]
* Firly Pond
* Firly Plateau
* Zelkoa Pond
* Lake Sumac
* Retsam Forest
* Walnot Mountains
* Hateno Beach
* Hateno Bay
* Solewood Range
* Kitano Bay
* Ebon Mountain
* Ginner Woods
* Camphor Pond
* Fir River
* Nirvata Lake

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12   | Collectible       | Qty (12) |
| ----- | ----------------- | -------- |
| 1     | Electric Safflina | 1        |
| 2-3   | Apple             | 2        |
| 4-5   | Hylian Shroom     | 2        |
| 6-7   | Ironshroom        | 2        |
| 8-9   | Palm Fruit        | 2        |
| 10-11 | Mighty Banana     | 2        |
| 12    | Fairy             | 1        |
^east-necluda-foraging

##### Fishing

| d6  | Collectible  | Qty (6) |
| --- | ------------ | ------- |
| 1-3 | Armored Carp | 3       |
| 4-6 | Mighty Porgy | 3       |
^east-necluda-fishing

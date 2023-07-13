#location [[Akkala Region]]

The Akkala Sea is the area of ocean found to the north-east of Hyrule, off the shores of Akkala Province.

### Locations

* [[Lomei Castle Island]]
* East Akkala Beach
* Malin Bay
* North Akkala Beach
* Rist Peninsula

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12  | Collectible       | Qty (12) |
| ---- | ----------------- | -------- |
| 1-4  | Zapshroom         | 4        |
| 5-6  | Electric Safflina | 2        |
| 7-8  | Dazzledrupe      | 2        |
| 9-10 | Swift Violet      | 2        |
| 11   | Fleet Lotus Seeds | 1        |
| 12   | Fairy             | 1        |
^akkala-sea-foraging

##### Fishing

| d6  | Collectible  | Qty (6) |
| --- | ------------ | ------- |
| 1-3 | Mighty Porgy | 3       |
| 4-6 | Armored Carp | 3       |
^akkala-sea-fishing

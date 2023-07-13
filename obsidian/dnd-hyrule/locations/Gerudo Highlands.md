#location [[Gerudo Region]]

Gerudo Highlands surrounds the Gerudo Desert. Its cliffs sit to the east of the Desert and its tall, snowy mountains overlook the Desert to the north.

```ad-info
title: Extreme Cold
A creature exposed to extreme cold must succeed on a DC 10 Constitution saving throw at the end of each hour or gain one level of exhaustion. Creatures with resistance or immunity to cold damage automatically succeed on the saving throw, as do creatures wearing cold weather gear (thick coats, gloves, and the like) and creatures naturally adapted to cold climates.
```

### Locations

* Statue of the Eighth Heroine
* Birida Lookout
* Cliffs of Ruvara
* Gerudo Summit
* Hemaar's Descent
* Laparoh Mesa
* Meadela's Mantle
* Mount Agaat
* Mount Nabooru
* Mystathi's Shelf
* Nephra Hill
* Risoka Snowfield
* Rutimala Hill
* Sapphia's Table
* Taafei Hill
* Vatorsa Snowfield
* Zirco Mesa

### Characters

```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

* Mystathi's Shelf Cave (large lightning circle on the cliff face) - do something cool with this area

### Collecting

##### Foraging

| d12  | Collectible   | Qty (12) |
| ---- | ------------- | -------- |
| 1-3  | Chillshroom   | 3        |
| 4-6  | Zapshroom     | 3        |
| 7-8  | Cool Safflina | 2        |
| 9-10 | Iceberry      | 2        |
| 11   | Shockpear   | 1        |
| 12   | Swift Violet  | 1        |
^gerudo-highlands-foraging

##### No Fishing

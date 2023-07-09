#location [[Lanayru Region]]

The Lanayru Sea is part of the ocean, covering much of Hyrule's east coast. In terms of Hyrule's provinces, it is - as the name suggests - primarily within Lanayru, but extends northward into the south-eastern part of Akkala, with islands within the northern Lanayru Sea formally part of the latter province.

### Locations

* Horon Lagoon
* Spool Bight
* Lanayru Bay
* Tarm Point
* Wintre Island

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### No Foraging

##### Fishing

| d6  | Collectible  | Qty (6) |
| --- | ------------ | ------- |
| 1-3 | Armored Carp | 3       |
| 4-6 | Mighty Porgy | 3       |
^lanayru-sea-fishing

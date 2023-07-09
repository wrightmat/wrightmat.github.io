#location #city  [[The Depths]]

As YunoboCo's final act, Yunobo organized the company to dig a new shaft to the Depths of Hyrule and build an elevator to access the area. With the gloom completely receded after Ganondorf's defeat, the ancient city of Gorondia was ready to be re-inhabited by the Goron people.

Many choose to remain on the Surface, but Yunobo himself decided to move the Chief's residence to Gorondia, leaving Goron City of the Surface as more of a visitor-oriented place of shops and inns (with some commuting from their homes in Gorondia to run the shops). The Gorons are very protective of their shaft to the Depths, and don't allow outsiders to ever use it.

### Locations



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

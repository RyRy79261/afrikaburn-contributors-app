---
title: "An App, an API, and Other Stories"
source: https://www.afrikaburn.org/latest-news/an-app-an-api-and-other-stories/
fetched: 2026-07-24
---

Lost? You are here: [Home](https://www.afrikaburn.org/) > [News](https://www.afrikaburn.org/news/) > [Latest News](https://www.afrikaburn.org/category/latest-news/) > An App, an API, and Other Stories

## An App, an API, and Other Stories

  * [ __ The Tim Doyle  ](https://www.afrikaburn.org/author/webadmin/)
  * [ __ October 29, 2018 ](https://www.afrikaburn.org/2018/10/29/)
  * __ 1:06 pm

  * __ Categories: [Latest News](https://www.afrikaburn.org/category/latest-news/)

So, as you’ll be able to tell, we’re making a large amount of headway in the Department Formerly Known as ICT. We’ve gotten ahead of ourselves and are now ready to offer access to the API for [our Tribe system](https://tribe.afrikaburn.com/). In case you weren’t aware, Tribe’s the space where members of Collectives collaborate on their registered projects. If you haven’t used it yet, log into our site and nose around – it’s a growing community space where dreams are hatched and shared.  
So, if you’ve got brilliant ideas for an AfrikaBurn App, a way to personalise the map, or you want to customise a WTF guide, then we’ve got good news for you!

# AfrikaBurn’s API is live!

  
As we don’t want to publish Collectives’ amazing projects in advance, the data we have available for testing is the AfrikaBurn 2018 data, until 21 April 2018. If you need to test with this year’s data or need access to AfrikaBurn 2019’s data early, you will need to request it from the cia@afrikaburn.com and enter an agreement to not publish early.  
NB: As with all AfrikaBurn content, this API is limited to noncommercial and marketing free apps only.

Locations data from artwork and Theme Camp placement happens in March each year, so the data is only available from early April. This is linked to town planning, and can’t be moved earlier, which is also part of the reason we’re releasing historic data for you to test with. Though we do our best to make sure the data is correct, we can not guarantee things play out exactly the way we plan.  
As there is no public internet connection on site, we can not guarantee that you will have live access to content (though we’d love to make a plan around this, and welcome any volunteers that would be available to assist with it). We also have an open mesh network on site that you can utilise to extend your concept, [see here for more details](https://www.afrikaburn.com/latest-news/what-the-is-the-open-mesh-network). We plan to begin experimenting with a DNS server in January, but if you are experienced with the technical aspects of a DNS server, your help would be greatly appreciated.  
Ultimately, if the DNS server is up and running you would also be able to build web-based apps that would not require that they are installed through the App Stores before arriving in the desert. Current HTML5 should allow you access to all the phone features like GPS, compass, motion sensors, etc.  
NB: if you want your app listed in the WTF guide, you will need to register it as a Binnekring Event on the [Tribe website](https://tribe.afrikaburn.com/). The communications team is also more than happy to push your app if you alert them to it. In addition, there are grants available for tech projects, which can also be applied for here. Please mail cia@afrikaburn.com to start the grant process.   
With all that said, and without further ado, the API and CSV links:  
<https://tribe.afrikaburn.com/develop/json>  
<https://tribe.afrikaburn.com/develop/csv>  
The API link for all projects on the current system:  
<https://tribe.afrikaburn.com/develop/json/all>  
<https://tribe.afrikaburn.com/develop/csv/all>  
(Currently only the 2018 and 2019 event details are listed. If you are a data wrangler with time on you hands, [please help us wrangle in some of our historic projects](mailto:cia@afrikaburn.com))

### Glossary of JSON details:

**nid / ID**  
_Type: integer_  
Unique content ID  
**type / Content type**  
_Type: list_  
Type of registered project.

  * Artwork
  * Binnekring Events
  * Mutant Vehicles
  * Theme Camps

  
**title / Title**  
_Type: Text short_  
Projects name  
**field_collective / Collective**  
_Type: Text short_  
The collective’s name that registered the project.  
One collective can have multiple projects.  
**field_prj_wtf_short_copy / WTF short blurb**  
_Type: Text long, multi-line_  
WTF Guide short blurb.  
Only available from 15 April  
**field_prj_wtf_long / Long Blurb**  
_Type: Text long, multi-line_  
WTF Guide short blurb.  
Only available from 15 April  
**field_prj_wtf_planned / Planned activities list**  
_Type: list_  
Planned events times, from check list.

  * Sunrise
  * Morning
  * Noon
  * Afternoon
  * Sunset
  * Evening
  * Night 7 till 11
  * Night 11 till 2
  * Night 2 till 6

  
**field_prj_wtf_categories / Activity Types**  
_Type: list_

  * Adult
  * Care and Support
  * Family Friendly
  * Food / Drink
  * For the Kids
  * Game / Sport
  * Musical Collaboration
  * Party / Gathering
  * Ritual / Ceremony
  * Workshop / Class

  
**field_prj_wtf_scheduled / Planned activities description**  
**Type: Text long, multi-line**  
Text description of the projects activity plans  
**field_prj_wtf_image / Image**  
_Type: image link_  
Link to the project image on https://tribe.afrikaburn.com  
**field_prj_gen_history / Year and name of previous projects**  
_Type: Text long, multi-line_  
Text write up of historic projects run by the collective  
**field_prj_wtf_website / Website**  
_Type: Multiple link field_  
Websites or social media pages of the project  
**field_prj_oth_relationship / Project associated**  
_Type: Text long,_ multi line  
Associate projects, and how they are associate.  
**field_prj_oth_associated / Associated**  
_Type: Multiple Integers_  
unique id of associated projects if registered.  
**field_prj_brn_burning / Burn**  
_Type: Boolean Yes / No_  
Is this project planing on burning?  
**field_prj_brn_time_adm / Burn Time**  
_Type: Date time_  
Proposed burn time. Very likely to change on the day.  
Only available from 15 April  
**field_prj_snd_sound / Sound**  
_Type: Boolean Yes / No_  
Is this project planning on using sound.  
**field_prj_snd_level / Sound Level**  
_Type: list_  
How loud do they plan on being.

  * Level 1 – Normal car stereo without sub woofers
  * Level 2 – Loud amplified sound
  * Level 3 – Large club or stadium size sound

  
**field_prj_adm_latitude / Placement Location GPS – Latitude (GPS – Latitude)**  
_Type: decimal up to 7 points._  
Only available from 15 April  
**field_prj_adm_longitude / Placement Location GPS – Longitude (GPS – Longitude)**  
_Type: decimal up to 7 points._  

* * *

  
Feel free to contact the team on cia@afrikaburn.com with any queries. We’re here to help and enable you. 

Share this article:

__

Facebook 

__

LinkedIn 

__

Reddit 

__

Telegram 

__

WhatsApp 

__

Email 

Related news:

  * __All __
  * __AfrikaBurn The Event __
  * __Anathi __
  * __Binnekring Blog __
  * __Burning Man __
  * __Creative Projects __
  * __Development __
  * __Job opportunities __
  * __Latest News __
  * __Leave No Trace __
  * __Participation __
  * __Quaggafontein __
  * __Streetopia __
  * __The Eleven Principles __
    * __Back
    *  __Art __
    * __Mutant Vehicles __
    * __Fundraisers __
    * __Theme Camps __
    * __Back
    *  __Rangers __
    * __Volunteers __
    * __DPW __
    * __Back
    *  __Tankwa Tips __
    * __Tickets __
    * __Suppliers __

![Boom!](https://www.afrikaburn.org/wp-content/uploads/2026/05/Kim-van-Zyl-AB26-5KVZ2430-ptg-f.jpg)

## 

[Boom!](https://www.afrikaburn.org/binnekringblog/boom/)

20 May 2026

Hear that? It’s the sound of you, along with 10,000...

[Read More](https://www.afrikaburn.org/binnekringblog/boom/)

![Screenshot](https://www.afrikaburn.org/wp-content/uploads/2026/04/WTF-head.jpg)

## 

[AfrikaBurn 2026 WTF?](https://www.afrikaburn.org/binnekringblog/afrikaburn-2026-wtf/)

20 April 2026

This year’s WTF? was put together by:Brian ‘The Brain’ Palmer...

[Read More](https://www.afrikaburn.org/binnekringblog/afrikaburn-2026-wtf/)

![AfrikaBurn 2026 Map](https://www.afrikaburn.org/wp-content/uploads/2026/04/MAP-THUMB.jpg)

## 

[AfrikaBurn 2026 Map](https://www.afrikaburn.org/binnekringblog/afrikaburn-2026-map/)

17 April 2026

Here’s your map for AfrikaBurn 2026 – Through The Prism...

[Read More](https://www.afrikaburn.org/binnekringblog/afrikaburn-2026-map/)

[__Prev PreviousWhat the **** is the Open Mesh network?](https://www.afrikaburn.org/latest-news/what-the-is-the-open-mesh-network/)

[NextDPW 2019 – STEP UP & SIGN UP!__Next](https://www.afrikaburn.org/latest-news/dpw-2019-step-up-sign-up/)

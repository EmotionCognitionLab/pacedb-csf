In order to receive a callback from Qualtrics when a user completes a survey you need to register your callback url with them.

You can find the complete details [at the Qualtrics web site](https://api.qualtrics.com/docs/listen-to-and-retrieve-responses-in-real-time), but here's the summary:

```
curl -X POST -H 'X-API-TOKEN: yourapitoken'  -H 'Content-Type: application/json' -d '{
    "topics": "surveyengine.completedResponse.SV_ebdf20QralHTzQF",
    "publicationUrl": "http://walkercodetutorials.com:8080",
    "encrypt": false
}' 'https://co1.qualtrics.com/API/v3/eventsubscriptions/'
```

function init() {
  console.log(getEncounterDDB());
}

function getEncounterDDB() {
  var r
  $.get({
    url: "https://encounter-service.dndbeyond.com/v1/encounters/54d34b6e-393a-4791-9ece-593b9c5745b1",
    contentType: "application/json",
    success: function(result) {
	r = result
    },
    error: function(xhr, error) {
	console.log(xhr)
    },
    async: false
  });
  return r
}
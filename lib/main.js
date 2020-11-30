const audioUtils        = require('./audioUtils');  // for encoding audio data as PCM
const crypto            = require('crypto'); // tot sign our pre-signed URL
const v4                = require('./aws-signature-v4'); // to generate our pre-signed URL
const marshaller        = require("@aws-sdk/eventstream-marshaller"); // for converting binary event stream messages to and from JSON
const util_utf8_node    = require("@aws-sdk/util-utf8-node"); // utilities for encoding and decoding UTF8
const mic               = require('microphone-stream'); // collect microphone input as a stream of raw bytes

// our converter between binary event streams messages and JSON
const eventStreamMarshaller = new marshaller.EventStreamMarshaller(util_utf8_node.toUtf8, util_utf8_node.fromUtf8);

// our global variables for managing state
let languageCode;
let region;
let sampleRate;
let inputSampleRate;
let transcription = "";
let socket;
let micStream;
let socketError = false;
let transcribeException = false;

// check to see if the browser allows mic access
if (!window.navigator.mediaDevices.getUserMedia) {
    // Use our helper method to show an error on the page
    showError('We support the latest versions of Chrome, Firefox, Safari, and Edge. Update your browser and try your request again.');

    // maintain enabled/distabled state for the start and stop buttons
    toggleStartStop();
}

$('#start-button').click(function () {
    $('#error').hide(); // hide any existing errors
    toggleStartStop(true); // disable start and enable stop button

    // set the language and region from the dropdowns
    setLanguage();
    setRegion();

    // first we get the microphone input from the browser (as a promise)...
    window.navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true
        })
        // ...then we convert the mic stream to binary event stream messages when the promise resolves 
        .then(streamAudioToWebSocket) 
        .catch(function (error) {
            showError('There was an error streaming your audio to Amazon Transcribe. Please try again.');
            toggleStartStop();
        });
});

let streamAudioToWebSocket = function (userMediaStream) {
    //let's get the mic input from the browser, via the microphone-stream module
    micStream = new mic();

    micStream.on("format", function(data) {
        inputSampleRate = data.sampleRate;
    });

    micStream.setStream(userMediaStream);

    // Pre-signed URLs are a way to authenticate a request (or WebSocket connection, in this case)
    // via Query Parameters. Learn more: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    let url = createPresignedUrl();

    //open up our WebSocket connection
    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    let sampleRate = 0;

    // when we get audio data from the mic, send it to the WebSocket if possible
    socket.onopen = function() {
        micStream.on('data', function(rawAudioChunk) {
            // the audio stream is raw audio bytes. Transcribe expects PCM with additional metadata, encoded as binary
            let binary = convertAudioToBinaryMessage(rawAudioChunk);

            if (socket.readyState === socket.OPEN)
                socket.send(binary);
        }
    )};

    // handle messages, errors, and close events
    wireSocketEvents();
}

function setLanguage() {
    languageCode = $('#language').find(':selected').val();
    if (languageCode == "en-US" || languageCode == "es-US")
        sampleRate = 44100;
    else
        sampleRate = 8000;
}

function setRegion() {
    region = $('#region').find(':selected').val();
}

function wireSocketEvents() {
    // handle inbound messages from Amazon Transcribe
    socket.onmessage = function (message) {
        //convert the binary event stream message to JSON
        let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(message.data));
        let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body));
        if (messageWrapper.headers[":message-type"].value === "event") {
            handleEventStreamMessage(messageBody);
        }
        else {
            transcribeException = true;
            showError(messageBody.Message);
            toggleStartStop();
        }
    };

    socket.onerror = function () {
        socketError = true;
        showError('WebSocket connection error. Try again.');
        toggleStartStop();
    };
    
    socket.onclose = function (closeEvent) {
        micStream.stop();
        
        // the close event immediately follows the error event; only handle one.
        if (!socketError && !transcribeException) {
            if (closeEvent.code != 1000) {
                showError('</i><strong>Streaming Exception</strong><br>' + closeEvent.reason);
            }
            toggleStartStop();
        }
    };
}

let handleEventStreamMessage = function (messageJson) {
    let results = messageJson.Transcript.Results;

    if (results.length > 0) {
        if (results[0].Alternatives.length > 0) {
            let transcript = results[0].Alternatives[0].Transcript;

            // fix encoding for accented characters
            transcript = decodeURIComponent(escape(transcript));

            // update the textarea with the latest result
            $('#transcript').val(transcription + transcript + "\n");

            // if this transcript segment is final, add it to the overall transcription
            if (!results[0].IsPartial) {
                //scroll the textarea down
                $('#transcript').scrollTop($('#transcript')[0].scrollHeight);

                transcription += transcript + "\n";
            }
        }
    }
}

let closeSocket = function () {
    if (socket.readyState === socket.OPEN) {
        micStream.stop();

        // Send an empty frame so that Transcribe initiates a closure of the WebSocket after submitting all transcripts
        let emptyMessage = getAudioEventMessage(Buffer.from(new Buffer([])));
        let emptyBuffer = eventStreamMarshaller.marshall(emptyMessage);
        socket.send(emptyBuffer);
    }
}

$('#stop-button').click(function () {
    closeSocket();
    toggleStartStop();
});

$('#reset-button').click(function (){
    $('#transcript').val('');
    transcription = '';
});

function toggleStartStop(disableStart = false) {
    $('#start-button').prop('disabled', disableStart);
    $('#stop-button').attr("disabled", !disableStart);
}

function showError(message) {
    $('#error').html('<i class="fa fa-times-circle"></i> ' + message);
    $('#error').show();
}

function convertAudioToBinaryMessage(audioChunk) {
    let raw = mic.toRaw(audioChunk);

    if (raw == null)
        return;

    // downsample and convert the raw audio bytes to PCM
    let downsampledBuffer = audioUtils.downsampleBuffer(raw, inputSampleRate, sampleRate);
    let pcmEncodedBuffer = audioUtils.pcmEncode(downsampledBuffer);

    // add the right JSON headers and structure to the message
    let audioEventMessage = getAudioEventMessage(Buffer.from(pcmEncodedBuffer));

    //convert the JSON object + headers into a binary event stream message
    let binary = eventStreamMarshaller.marshall(audioEventMessage);

    return binary;
}

function getAudioEventMessage(buffer) {
    // wrap the audio data in a JSON envelope
    return {
        headers: {
            ':message-type': {
                type: 'string',
                value: 'event'
            },
            ':event-type': {
                type: 'string',
                value: 'AudioEvent'
            }
        },
        body: buffer
    };
}

function createPresignedUrl() {
    let endpoint = "transcribestreaming." + region + ".amazonaws.com:8443";

    // get a preauthenticated URL that we can use to establish our WebSocket
    return v4.createPresignedURL(
        'GET',
        endpoint,
        '/stream-transcription-websocket',
        'transcribe',
        crypto.createHash('sha256').update('', 'utf8').digest('hex'), {
            'key': $('#access_id').val(),
            'secret': $('#secret_key').val(),
            'sessionToken': $('#session_token').val(),
            'protocol': 'wss',
            'expires': 15,
            'region': region,
            'query': "language-code=" + languageCode + "&media-encoding=pcm&sample-rate=" + sampleRate
        }
    );
}

(function () {
    var textFile = null,
        makeTextFile = function (text) {
            var data = new Blob([text], { type: 'text/plain' });

            if (textFile !== null) {
                window.URL.revokeObjectURL(textFile);
            }

            textFile = window.URL.createObjectURL(data);

            return textFile;
        };


    var create = document.getElementById('create'),
        transcript = document.getElementById('transcript');

    create.addEventListener('click', function () {
        var link = document.getElementById('downloadlink');
        link.href = makeTextFile(transcript.value);
        link.style.display = 'block';
    }, false);
})();

/*
function s3upload() {
    var files = document.getElementById('fileUpload').files;
    if (files) {
        var file = files[0];
        var fileName = file.name;
        var filePath = 'medicaltext/' + fileName;
            //'my-first-bucket-path/' + fileName;
            //medicaltext.s3.amazonaws.com/file1.txt

        var fileUrl = 'https://s3.console.aws.amazon.com/s3/buckets/medicaltext?region=us-east-1&tab=objects/' + filePath; 
            //   'https://' + 's3.console.aws.amazon.com/s3/buckets/medicaltext?region=us-east-1' + filePath;
            //   ' + bucketRegion + '.s3.amazonaws.com / medicaltext / ' + filePath;
            //'https://' + bucketRegion + '.amazonaws.com/my-first-bucket/' +  filePath;
            //ttp://s3.amazonaws.com/yourbucket/yourobject
            //s3.console.aws.amazon.com/s3/buckets/medicaltext?region=us-east-1&tab=objects
            
        s3.upload({
            Key: filePath,
            Body: file,
            ACL: 'public-read'
        }, function (err, data) {
            if (err) {
                reject('error');
            }
            alert('Successfully Uploaded!');
        }).on('httpUploadProgress', function (progress) {
            var uploaded = parseInt((progress.loaded * 100) / progress.total);
            $("progress").attr('value', uploaded);
        });
    }
};

*/

var patientBucketName = "medicaltext";
var bucketRegion = "us-east-1";
var IdentityPoolId = "us-east-1:f6ae3963-f4c5-40fa-b079-942f4117423c";

AWS.config.update({
    region: bucketRegion,
    credentials: new AWS.CognitoIdentityCredentials({
        IdentityPoolId: IdentityPoolId
    })
});

var s3 = new AWS.S3({
    apiVersion: "2006-03-01",
    params: { Bucket: patientBucketName }
});

function createPatientRecord(patientName) {
    patientName = patientName.trim();
    if (!patientName) {
        return alert("Patient names must contain at least one non-space character.");
    }
    if (patientName.indexOf("/") !== -1) {
        return alert("Patient names cannot contain slashes.");
    }
    var patientKey = encodeURIComponent(patientName);
    s3.headObject({ Key: patientKey }, function (err, data) {
        if (!err) {
            return alert("Patient already exists.");
        }
        if (err.code !== "NotFound") {
            return alert("There was an error creating this patient record: " + err.message);
        }
        s3.putObject({ Key: patientKey }, function (err, data) {
            if (err) {
                return alert("There was an error creating this patient record: " + err.message);
            }
            alert("Successfully created patient.");
            viewPatient(patientName);
        });
    });
}

function viewPatient(patientName) {
    var patientFilesKey = encodeURIComponent(patientName) + "/";
    s3.listObjects({ Prefix: patientFilesKey }, function (err, data) {
        if (err) {
            return alert("There was an error viewing the patient files: " + err.message);
        }
        // 'this' references the AWS.Response instance that represents the response
        var href = this.request.httpRequest.endpoint.href;
        var bucketUrl = href + patientBucketName + "/";

        var photos = data.Contents.map(function (photo) {
            var fileKey = photo.Key;
            var photoUrl = bucketUrl + encodeURIComponent(fileKey);
            return getHtml([
                "<span>",
                "<div>",
                '<img style="width:128px;height:128px;" src="' + photoUrl + '"/>',
                "</div>",
                "<div>",
                "<span onclick=\"deleteFile('" +
                patientName +
                "','" +
                fileKey +
                "')\">",
                "X",
                "</span>",
                "<span>",
                fileKey.replace(patientFilesKey, ""),
                "</span>",
                "</div>",
                "</span>"
            ]);
        });
        var message = photos.length
            ? "<p>Click on the X to delete the photo</p>"
            : "<p>You do not have any photos in this album. Please add photos.</p>";
        var htmlTemplate = [
            "<h2>",
            "Album: " + patientName,
            "</h2>",
            message,
            "<div>",
            getHtml(photos),
            "</div>",
            '<input id="photoupload" type="file" accept="image/*">',
            '<button id="addfile" onclick="addFile(\'' + patientName + "')\">",
            "Add Photo",
            "</button>",
            '<button onclick="listRecords()">',
            "Back To Albums",
            "</button>"
        ];
        document.getElementById("app").innerHTML = getHtml(htmlTemplate);
    });
}

function addFile(patientName) {
    var files = document.getElementById("photoupload").files;
    if (!files.length) {
        return alert("Please choose a file to upload first.");
    }
    var file = files[0];
    var fileName = file.name;
    var patientFilesKey = encodeURIComponent(patientName) + "/";

    var fileKey = patientFilesKey + fileName;

    // Use S3 ManagedUpload class as it supports multipart uploads
    var upload = new AWS.S3.ManagedUpload({
        params: {
            Bucket: patientBucketName,
            Key: fileKey,
            Body: file,
            ACL: "public-read"
        }
    });

    var promise = upload.promise();

    promise.then(
        function (data) {
            alert("Successfully uploaded file.");
            viewPatient(patientName);
        },
        function (err) {
            return alert("There was an error uploading your file: ", err.message);
        }
    );
}

function deleteFile(patientName, fileKey) {
    s3.deleteObject({ Key: fileKey }, function (err, data) {
        if (err) {
            return alert("There was an error deleting your file: ", err.message);
        }
        alert("Successfully deleted file.");
        viewPatient(patientName);
    });
}

function deletePatient(patientName) {
    var patientKey = encodeURIComponent(patientName) + "/";
    s3.listObjects({ Prefix: patientKey }, function (err, data) {
        if (err) {
            return alert("There was an error deleting the selected patient record: ", err.message);
        }
        var objects = data.Contents.map(function (object) {
            return { Key: object.Key };
        });
        s3.deleteObjects(
            {
                Delete: { Objects: objects, Quiet: true }
            },
            function (err, data) {
                if (err) {
                    return alert("There was an error deleting the selected patient record: ", err.message);
                }
                alert("Successfully deleted the selected patient record.");
                listRecords();
            }
        );
    });
}

var patientBucketName = "medicaltext";
var bucketRegion = "us-east-1";
var IdentityPoolId = "us-east-1:f6ae3963-f4c5-40fa-b079-942f4117423c";

AWS.config.update({
    region: bucketRegion,
    credentials: new AWS.CognitoIdentityCredentials({
        IdentityPoolId: IdentityPoolId
    })
});

var s3 = new AWS.S3({
    apiVersion: "2006-03-01",
    params: { Bucket: patientBucketName }
});

function listRecords() {
    s3.listObjects({ Delimiter: "/" }, function (err, data) {
        if (err) {
            return alert("There was an error listing the patient records: " + err.message);
        } else {
            var files = data.CommonPrefixes.map(function (commonPrefix) {
                var prefix = commonPrefix.Prefix;
                var recordName = decodeURIComponent(prefix.replace("/", ""));
                return getHtml([
                    "<li>",
                    "<span onclick=\"deletePatientRecord('" + recordName + "')\">X</span>",
                    "<span onclick=\"viewPatient('" + recordName + "')\">",
                    recordName,
                    "</span>",
                    "</li>"
                ]);
            });
            var message = files.length
                ? getHtml([
                    "<p>Click on an patient name to view it.</p>",
                    "<p>Click on the X to delete the patient record.</p>"
                ])
                : "<p>You do not have any files. Please create a patient record.";
            var htmlTemplate = [
                "<h2>files</h2>",
                message,
                "<ul>",
                getHtml(files),
                "</ul>",
                "<button onclick=\"createPatient(prompt('Enter Album Name:'))\">",
                "Create New Album",
                "</button>"
            ];
            document.getElementById("app").innerHTML = getHtml(htmlTemplate);
        }
    });
}

function createPatient(recordName) {
    recordName = recordName.trim();
    if (!recordName) {
        return alert("Patient names must contain at least one non-space character.");
    }
    if (recordName.indexOf("/") !== -1) {
        return alert("Patient names cannot contain slashes.");
    }
    var fileKey = encodeURIComponent(recordName);
    s3.headObject({ Key: fileKey }, function (err, data) {
        if (!err) {
            return alert("Patient already exists.");
        }
        if (err.code !== "NotFound") {
            return alert("There was an error creating the patient record: " + err.message);
        }
        s3.putObject({ Key: fileKey }, function (err, data) {
            if (err) {
                return alert("There was an error creating the patient record: " + err.message);
            }
            alert("Successfully created patient.");
            viewPatient(recordName);
        });
    });
}

function viewPatient(recordName) {
    var patientFilesKey = encodeURIComponent(recordName) + "/";
    s3.listObjects({ Prefix: patientFilesKey }, function (err, data) {
        if (err) {
            return alert("There was an error viewing the patient files: " + err.message);
        }
        // 'this' references the AWS.Response instance that represents the response
        var href = this.request.httpRequest.endpoint.href;
        var bucketUrl = href + patientBucketName + "/";

        var files = data.Contents.map(function (photo) {
            var photoKey = photo.Key;
            var photoUrl = bucketUrl + encodeURIComponent(photoKey);
            return getHtml([
                "<span>",
                "<div>",
                '<img style="width:128px;height:128px;" src="' + photoUrl + '"/>',
                "</div>",
                "<div>",
                "<span onclick=\"deleteFile('" +
                recordName +
                "','" +
                photoKey +
                "')\">",
                "X",
                "</span>",
                "<span>",
                photoKey.replace(patientFilesKey, ""),
                "</span>",
                "</div>",
                "</span>"
            ]);
        });
        var message = files.length
            ? "<p>Click on the X to delete the photo</p>"
            : "<p>You do not have any files attached to this patient. Please add files.</p>";
        var htmlTemplate = [
            "<h2>",
            "Album: " + recordName,
            "</h2>",
            message,
            "<div>",
            getHtml(files),
            "</div>",
            '<input id="fileupload" type="file" accept="image/*">',
            '<button id="addFile" onclick="addFile(\'' + recordName + "')\">",
            "Add Photo",
            "</button>",
            '<button onclick="listRecords()">',
            "Back To files",
            "</button>"
        ];
        document.getElementById("app").innerHTML = getHtml(htmlTemplate);
    });
}

function addFile(recordName) {
    var files = document.getElementById("fileupload").files;
    if (!files.length) {
        return alert("Please choose a file to upload first.");
    }
    var file = files[0];
    var fileName = file.name;
    var patientFilesKey = encodeURIComponent(recordName) + "/";

    var photoKey = patientFilesKey + fileName;

    // Use S3 ManagedUpload class as it supports multipart uploads
    var upload = new AWS.S3.ManagedUpload({
        params: {
            Bucket: patientBucketName,
            Key: photoKey,
            Body: file,
            ACL: "public-read"
        }
    });

    var promise = upload.promise();

    promise.then(
        function (data) {
            alert("Successfully uploaded file.");
            viewPatient(recordName);
        },
        function (err) {
            return alert("There was an error uploading your file: ", err.message);
        }
    );
}

function deleteFile(recordName, photoKey) {
    s3.deleteObject({ Key: photoKey }, function (err, data) {
        if (err) {
            return alert("There was an error deleting your file: ", err.message);
        }
        alert("Successfully deleted file.");
        viewPatient(recordName);
    });
}

function deletePatientRecord(recordName) {
    var fileKey = encodeURIComponent(recordName) + "/";
    s3.listObjects({ Prefix: fileKey }, function (err, data) {
        if (err) {
            return alert("There was an error deleting the patient record: ", err.message);
        }
        var objects = data.Contents.map(function (object) {
            return { Key: object.Key };
        });
        s3.deleteObjects(
            {
                Delete: { Objects: objects, Quiet: true }
            },
            function (err, data) {
                if (err) {
                    return alert("There was an error deleting the patient record: ", err.message);
                }
                alert("Successfully deleted the patient record.");
                listRecords();
            }
        );
    });
}


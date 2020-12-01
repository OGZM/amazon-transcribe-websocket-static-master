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
    params: { Bucket: albumBucketName }
});
// snippet-end:[s3.JavaScript.photoAlbumExample.config]
function getHtml(template) {
    return template.join('\n');
}
// snippet-start:[s3.JavaScript.photoAlbumExample.listAlbums]
function listAlbums() {
    s3.listObjects({ Delimiter: "/" }, function (err, data) {
        if (err) {
            return alert("There was an error listing your albums: " + err.message);
        } else {
            var albums = data.CommonPrefixes.map(function (commonPrefix) {
                var prefix = commonPrefix.Prefix;
                var albumName = decodeURIComponent(prefix.replace("/", ""));
                return getHtml([
                    "<li>",
                    "<span onclick=\"deleteAlbum('" + albumName + "')\">X</span>",
                    "<span onclick=\"viewAlbum('" + albumName + "')\">",
                    albumName,
                    "</span>",
                    "</li>"
                ]);
            });
            var message = albums.length
                ? getHtml([
                    "<p>Click on an album name to view it.</p>",
                    "<p>Click on the X to delete the album.</p>"
                ])
                : "<p>You do not have any albums. Please Create album.";
            var htmlTemplate = [
                "<h2>Albums</h2>",
                message,
                "<ul>",
                getHtml(albums),
                "</ul>",
                "<button onclick=\"createAlbum(prompt('Enter Album Name:'))\">",
                "Create New Album",
                "</button>"
            ];
            document.getElementById("app").innerHTML = getHtml(htmlTemplate);
        }
    });
}
// snippet-end:[s3.JavaScript.photoAlbumExample.listAlbums]

// snippet-start:[s3.JavaScript.photoAlbumExample.createAlbum]
function createAlbum(albumName) {
    albumName = albumName.trim();
    if (!albumName) {
        return alert("Album names must contain at least one non-space character.");
    }
    if (albumName.indexOf("/") !== -1) {
        return alert("Album names cannot contain slashes.");
    }
    var albumKey = encodeURIComponent(albumName);
    s3.headObject({ Key: albumKey }, function (err, data) {
        if (!err) {
            return alert("Album already exists.");
        }
        if (err.code !== "NotFound") {
            return alert("There was an error creating your album: " + err.message);
        }
        s3.putObject({ Key: albumKey }, function (err, data) {
            if (err) {
                return alert("There was an error creating your album: " + err.message);
            }
            alert("Successfully created album.");
            viewAlbum(albumName);
        });
    });
}
// snippet-end:[s3.JavaScript.photoAlbumExample.createAlbum]

// snippet-start:[s3.JavaScript.photoAlbumExample.viewAlbum]
function viewAlbum(albumName) {
    var albumPhotosKey = encodeURIComponent(albumName) + "/";
    s3.listObjects({ Prefix: albumPhotosKey }, function (err, data) {
        if (err) {
            return alert("There was an error viewing your album: " + err.message);
        }
        // 'this' references the AWS.Response instance that represents the response
        var href = this.request.httpRequest.endpoint.href;
        var bucketUrl = href + albumBucketName + "/";

        var photos = data.Contents.map(function (photo) {
            var photoKey = photo.Key;
            var photoUrl = bucketUrl + encodeURIComponent(photoKey);
            return getHtml([
                "<span>",
                "<div>",
                '<img style="width:128px;height:128px;" src="' + photoUrl + '"/>',
                "</div>",
                "<div>",
                "<span onclick=\"deletePhoto('" +
                albumName +
                "','" +
                photoKey +
                "')\">",
                "X",
                "</span>",
                "<span>",
                photoKey.replace(albumPhotosKey, ""),
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
            "Album: " + albumName,
            "</h2>",
            message,
            "<div>",
            getHtml(photos),
            "</div>",
            '<input id="photoupload" type="file" accept="image/*">',
            '<button id="addphoto" onclick="addPhoto(\'' + albumName + "')\">",
            "Add Photo",
            "</button>",
            '<button onclick="listAlbums()">',
            "Back To Albums",
            "</button>"
        ];
        document.getElementById("app").innerHTML = getHtml(htmlTemplate);
    });
}
// snippet-end:[s3.JavaScript.photoAlbumExample.viewAlbum]

// snippet-start:[s3.JavaScript.photoAlbumExample.addPhoto]
function addPhoto(albumName) {
    var files = document.getElementById("photoupload").files;
    if (!files.length) {
        return alert("Please choose a file to upload first.");
    }
    var file = files[0];
    var fileName = file.name;
    var albumPhotosKey = encodeURIComponent(albumName) + "/";

    var photoKey = albumPhotosKey + fileName;

    // Use S3 ManagedUpload class as it supports multipart uploads
    var upload = new AWS.S3.ManagedUpload({
        params: {
            Bucket: albumBucketName,
            Key: photoKey,
            Body: file,
            ACL: "public-read"
        }
    });

    var promise = upload.promise();

    promise.then(
        function (data) {
            alert("Successfully uploaded photo.");
            viewAlbum(albumName);
        },
        function (err) {
            return alert("There was an error uploading your photo: ", err.message);
        }
    );
}
// snippet-end:[s3.JavaScript.photoAlbumExample.addPhoto]

// snippet-start:[s3.JavaScript.photoAlbumExample.deletePhoto]
function deletePhoto(albumName, photoKey) {
    s3.deleteObject({ Key: photoKey }, function (err, data) {
        if (err) {
            return alert("There was an error deleting your photo: ", err.message);
        }
        alert("Successfully deleted photo.");
        viewAlbum(albumName);
    });
}
// snippet-end:[s3.JavaScript.photoAlbumExample.deletePhoto]

// snippet-start:[s3.JavaScript.photoAlbumExample.deleteAlbum]
function deleteAlbum(albumName) {
    var albumKey = encodeURIComponent(albumName) + "/";
    s3.listObjects({ Prefix: albumKey }, function (err, data) {
        if (err) {
            return alert("There was an error deleting your album: ", err.message);
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
                    return alert("There was an error deleting your album: ", err.message);
                }
                alert("Successfully deleted album.");
                listAlbums();
            }
        );
    });
}

/*
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


*/
require("dotenv/config");

const express = require("express");
const multer = require("multer");
const AWS = require("aws-sdk");
const uuid = require("uuid/v4");
const cors = require("cors");
const bodyParser = require("body-parser");
const mongodb = require("mongodb");
const MongoClient = mongodb.MongoClient;
const { nanoid } = require("nanoid");
const jwt = require("jsonwebtoken");
const bycrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const authenticate = require("./services/authentication");
const MailService = require("./services/mail");
const Validator = require("./services/validator");
const validator = new Validator();


const app = express();
const port = process.env.PORT || 5000;
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  cors({
    origin: "*",
  })
);
const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLEINT_SECRET,
  process.env.REDIRECT_URI
);
oAuth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

origin = "http://localhost:3000";

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const storage = multer.memoryStorage({
  destination: function (req, file, callback) {
    callback(null, "");
  },
});

const upload = multer({ storage }).single("image");

app.post("/upload", upload, (req, res) => {
  let myFile = req.file.originalname.split(".");
  const fileType = myFile[myFile.length - 1];

  const params = {
    Bucket: process.env.S3_BUCKET,
    Key: `${uuid()}.${fileType}`,
    Body: req.file.buffer,
    ACL: "public-read",
  };

  s3.upload(params, (error, data) => {
    if (error) {
      res.status(500).send(error);
    }

    res.status(200).send(data);
  });
});

app.post("/file", authenticate, async (req, res) => {
  let connection = await MongoClient.connect(process.env.MONGODB_URL, {
    useUnifiedTopology: true,
  });

  try {
    let db = connection.db(process.env.DB_NAME);

    let postdata = {
      email: req.body.email,
      location: req.body.location,
      createdday: new Date().toLocaleDateString(),
      createdtime: new Date().toLocaleTimeString(),
      nanoid: nanoid(),
      filename: req.body.filename,
    };
    console.log(req.body.location);
    await db.collection("files").insertOne(postdata);
    res.json({
      message: "file created Successfully",
      data: postdata,
    });
  } catch (error) {
    res.status(400).json({
      message: "failed to create file",
    });
  } finally {
    connection.close();
  }
});

app.post("/sign_up", async (req, res) => {
  let connection = await MongoClient.connect(process.env.MONGODB_URL, {
    useUnifiedTopology: true,
  });
  try {
    let db = connection.db(process.env.DB_NAME);
    let user1 = await db.collection("users").findOne({ email: req.body.email });
    if (user1) {
      res.json({
        message: "user Already exists",
      });
    } else if (!validator.isEmail(req.body.email)) {
      res.status(400).json({
        message: "Invalid  Email, please enter a valid email",
      });
    } else {
      let salt = await bycrypt.genSalt(10);
      let hash = await bycrypt.hash(req.body.password, salt);
      req.body.password = hash;
      await db
        .collection("users")
        .insertOne({ email: req.body.email, password: req.body.password });
      const mail = new MailService();

      const mailSubject = "Registration for uploder app";

      const mailTo = req.body.email;

      const mailBody = `<div>
 <h3> successfully registered </h3>
 <p>Please click the given link to login <a target="_blank" href="${origin}/login"> click here </a></p>
</div>`;

      mail.sendMail(mailSubject, mailBody, mailTo);

      res.json({
        message: "User Registered Successfully check the mail",
      });
    }
  } catch (err) {
    console.log(err);
    res.status(400).json({
      message: "Unable to register please enter valid details",
    });
  } finally {
    connection.close();
  }
});

app.post("/login", async (req, res) => {
  let connection = await MongoClient.connect(process.env.MONGODB_URL, {
    useUnifiedTopology: true,
  });

  try {
    let db = connection.db(process.env.DB_NAME);
    let user = await db.collection("users").findOne({ email: req.body.email });
    if (user) {
      let isUserAuthenticated = await bycrypt.compare(
        req.body.password,
        user.password
      );
      if (isUserAuthenticated) {
        let token = jwt.sign(
          { userid: user._id, email: user.email },
          process.env.JWT_TOKEN,
          
        );
        res.json({
          message: "User Authenticated Successfully",
          token,
          data: {
            email: user.email,
          },
        });
      } else {
        res.status(400).json({
          message: "Password is wrong for the provided email",
        });
      }
    } else {
      res.status(400).json({
        message: "Entered Email does not exists",
      });
    }
  } catch (err) {
    res.status(400).json({
      message: "Unable to login please enter valid credentials",
    });
  } finally {
    connection.close();
  }
});

app.get("/ping", authenticate, async (req, res) => {
  let connection = await MongoClient.connect(process.env.MONGODB_URL, {
    useUnifiedTopology: true,
  });
  try {
    let db = connection.db(process.env.DB_NAME);
    let user = await db.collection("users").findOne({ email: req.body.email });

    if (user) {
      res.json({
        message: "user is logged in",
        data: {
          email: req.body.email,
          userid: req.body.userid,
        },
      });
    } else {
      res.status(400).json({
        message: "User Does not exists",
      });
    }
  } catch (err) {
    console.log(err);
  }
});

app.post("/forget-password", async (req, res) => {
  let connection = await MongoClient.connect(process.env.MONGODB_URL, {
    useUnifiedTopology: true,
  });
  try {
    let db = connection.db(process.env.DB_NAME);
    let user = await db.collection("users").findOne({ email: req.body.email });

    if (user) {
      // let token = await crypto.randomBytes(20);
      let resetToken = nanoid(10);

      
      console.log(user);
      await db.collection("users").updateOne(
        { _id: user._id },
        {
          $set: { resetToken: resetToken , resetTokenExpires: Date.now() + 300000 },
        }
      );
      const mail = new MailService();

      const mailSubject = "Reset password for uploder app";

      const mailTo = req.body.email;
      const  mailBody = `<div>
              <h3>Reset Password</h3>
              <p>Please click the given link to reset your password <a target="_blank" href="${origin}/resetpassword/${encodeURIComponent(
                resetToken
      )}"> click here </a></p>
          </div>`;
          mail.sendMail(mailSubject, mailBody, mailTo);
      
      res.json({
        message: "Email sent",
      });
    } else {
      res.json({
        message: "Email not sent",
      });
    }
  } catch (err) {
    console.log(err);
  } finally {
    connection.close();
  }
});

app.put("/reset", async (req, res) => {
  console.log("reset", decodeURIComponent(req.body.token));
  let connection = await MongoClient.connect(process.env.MONGODB_URL, {
    useUnifiedTopology: true,
  });
  try {
    let db = connection.db(process.env.DB_NAME);

    let user = await db.collection("users").findOne({
      resetToken: decodeURIComponent(req.body.token),
      resetTokenExpires: { $gt: Date.now() },
    });
    console.log(user);
    if (user) {
      let salt = await bycrypt.genSalt(10);
      console.log(req.body.password);
      let password = await bycrypt.hash(req.body.password, salt);
      console.log(password);
      let updateInfo = await db
        .collection("users")
        .updateOne({ _id: user._id }, { $set: { password: password } });

      if (updateInfo.modifiedCount > 0) {
        await db
          .collection("users")
          .updateOne(
            { _id: user._id },
            { $set: { resetToken: "", resetTokenExpires: "" } }
          );
          let mailBody = `<div>
          <h3> Password reset successful </h3>
          <p>Please click the given link to login <a target="_blank" href="${origin}/login"> click here </a></p>
          </div>`;
          const mail = new MailService();

          const mailSubject = "Reset password sucessfull for uploder app";
    
          const mailTo = user.email;
          mail.sendMail(mailSubject, mailBody, mailTo);
      
       
      }
      res.status(200).json({
        message: "password reset succesfull",
      });
    } else {
      res.status(400).json({
        message: "user with valid token is not found",
      });
    }
  } catch (err) {
    console.log(err);
  } finally {
    connection.close();
  }
});
app.get("/files", authenticate, async (req, res) => {
  console.log(req.body);
  //create connection
  let connection = await MongoClient.connect(process.env.MONGODB_URL, {
    useUnifiedTopology: true,
  });
  try {
    let db = connection.db(process.env.DB_NAME);
    let urlData = await db
      .collection("files")
      .find({ email: req.body.email })
      .toArray();
    console.log(urlData);
    res.json({
      message: "files fetched successfully",
      data: urlData,
    });
  } catch (err) {
    res.status(401).json({
      message: "Some Error Occured",
      data: err,
    });
  } finally {
    connection.close();
  }
});

app.delete("/deletefile", authenticate, async (req, res) => {
  console.log(req.body);
  //create connection
  let connection = await MongoClient.connect(process.env.MONGODB_URL, {
    useUnifiedTopology: true,
  });
  try {
    let db = connection.db(process.env.DB_NAME);
    let urlData = await db
      .collection("files")
      .deleteOne({ nanoid: req.body.nanoid })
    console.log(urlData);
    res.json({
      message: "files deleted successfully",
      data: urlData,
    });
  } catch (err) {
    res.status(401).json({
      message: "Some Error Occured",
      data: err,
    });
  } finally {
    connection.close();
  }
});

app.listen(port, () => {
  console.log(`Server is up at ${port}`);
});

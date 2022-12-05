const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');

const port = process.env.PORT || 5000

require('dotenv').config();


const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY)
const app = express()

app.use(cors())
app.use(express.json())






app.get('/', async (req, res) => {
    res.send('doctors portal server is running start')
})




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ue2o2me.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function sendBookingEmail(booking) {
    const { email, treatement, appointmentDate, slot } = booking;


    // let transporter = nodemailer.createTransport({
    //     host: 'smtp.sendgrid.net',
    //     port: 587,
    //     auth: {
    //         user: "apikey",
    //         pass: process.env.SENDGRID_API_KEY
    //     }
    // });
    const auth = {
        auth: {
            api_key: process.env.EMAIL_SEND_KEY,
            domain: process.env.EMAIL_SEND_DOMAIN
        }
    }

    const transporter = nodemailer.createTransport(mg(auth));
    transporter.sendMail({
        from: "ashimmollick46@gmail.com", // verified sender email
        to: email || 'ashimmollick46@gmail.com', // recipient email
        subject: `Your appointment for ${treatement} on confirmed`, // Subject line
        text: "Hello world!", // plain text body
        html: `
        <h3>Your Appointment is Confirmed</h3>
        <div>
        <p>Your appointment for treatment :${treatement}</p>
        <p>Your visit on ${appointmentDate} at ${slot}</p>
        <p>Thanks for doctors potals</p>

        </div>
        
        `, // html body
    }, function (error, info) {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
}

function verifyJwt(req, res, next) {

    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('Unauthroze access')
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })
}
async function run() {
    try {
        const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOption');
        const bookingsCollection = client.db('doctorsPortal').collection('booking');
        const usersCollection = client.db('doctorsPortal').collection('users');
        const doctorsCollection = client.db('doctorsPortal').collection('doctors');
        const paymentsCollection = client.db('doctorsPortal').collection('payments');
        // NOTE: make sure you use verifyAdmin after verifyJWT
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }
        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();

            // get the bookings of the provided date
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

            // code carefully :D
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatement === option.name);
                const bookedSlots = optionBooked.map(book => book.slot);
                const remainingSlot = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlot

            })
            res.send(options);
        });
        app.get('/appointmentSpecialty', async (req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
            res.send(result)
        })
        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query)
            res.send({ isAdmin: user?.role === 'admin' });
        })
        app.get('/users', async (req, res) => {
            const query = {}
            const users = await usersCollection.find(query).toArray();
            res.send(users)
        })
        app.put('/users/admin/:id', verifyJwt, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const options = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, options)
            res.send(result)
        });

        app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result);
        })
        app.get('/bookings/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingsCollection.findOne(query);
            res.send(booking);
        })

        // temporary to update price field on appointment options
        // app.get('/addPrice', async (req, res) => {
        //     const filter = {}
        //     const options = { upsert: true }
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options);
        //     res.send(result);
        // })

        app.get('/booking', verifyJwt, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'Forbidded access' })
            }
            const query = { email: email };
            const bookings = await bookingsCollection.find(query).toArray();
            res.send(bookings)
        })

        app.post('/booking', async (req, res) => {
            const booking = req.body;

            const query = {
                appointmentDate: booking.appointmentDate,
                email: booking.email,
                treatement: booking.treatement
            }
            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `You have alreay booking on ${booking.appointmentDate}`;
                return res.send({ acknowledged: false, message })
            }

            const resulte = await bookingsCollection.insertOne(booking)
            // send email  about appointment confirmation
            sendBookingEmail(booking)
            res.send(resulte)
        });
        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
                return res.send({ accesToken: token })
            }
            console.log(user)
            res.status(403).send({ accesToken: '' })
        })
        app.post('/users', verifyJwt, async (req, res) => {
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result)
        });
        app.get('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        })
        app.post('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });
        app.delete('/doctors/:id', verifyJwt, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: ObjectId(id) };
            const result = await doctorsCollection.deleteOne(filter);
            res.send(result);
        })


    }
    finally {

    }
}
run().catch(console.log)


app.listen(port, () => console.log(`Doctor potal running on ${port}`))
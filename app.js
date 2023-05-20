require('dotenv').config();

const bodyParser = require('body-parser');
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

const mysql = require('mysql2');
const connection = mysql.createConnection(process.env.DATABASE_URL);

connection.connect();

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // Límite de tamaño del archivo (10 MB en este ejemplo)
});

app.set('view engine', 'ejs');

const AWS = require('aws-sdk');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));


app.get('/', (req, res) => {
  connection.query('SELECT * FROM crudimg', (error, results, fields) => {
    if (error) throw error;
    res.render('index', { data: results });
  });
});

app.get('/delete/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const [row] = await connection.promise().query('SELECT imagen FROM crudimg WHERE id = ?', [id]);
    const imagen = row[0].imagen;

    if (imagen) {
      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: imagen
      };

      await s3.deleteObject(params).promise();
    }

    await connection.promise().query('DELETE FROM crudimg WHERE id = ?', [id]);
    res.redirect('/');
  } catch (error) {
    console.error('Error al eliminar la imagen de S3 o el registro de la base de datos: ' + error);
    res.status(500).send('Error al eliminar la imagen o el registro.');
  }
});

app.get('/create', (req, res) => {
  res.render('create');
});

app.post('/save', upload.single('imagen'), async (req, res) => {
  const nombre = req.body.nombre;
  const descripcion = req.body.descripcion;
  const cantidad = req.body.cantidad;
  const marca = req.body.marca;
  const precio = req.body.precio;
  const imagen = req.file ? req.file.buffer : null;

  try {
    let s3Key = null;

    if (imagen) {
      s3Key = `${Date.now()}-${req.file.originalname}`;
      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Key,
        Body: imagen
      };

      await s3.upload(params).promise();
    }

    await connection.promise().query(
      'INSERT INTO crudimg SET ?',
      { nombre, descripcion, cantidad, marca, precio, imagen: s3Key }
    );
    res.redirect('/');
  } catch (error) {
    console.error('Error al subir la imagen a S3 o guardar la información en la base de datos: ' + error);
    res.status(500).send('Error al subir la imagen o guardar la información.');
  }
});

app.get('/edit/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const [row] = await connection.promise().query('SELECT * FROM crudimg WHERE id = ?', [id]);
    const crudimg = row[0];

    if (crudimg && crudimg.imagen) {
      const imageUrl = `/images/${crudimg.imagen}`; // URL de la imagen
      res.render('edit', { crudimg: crudimg, imageUrl: imageUrl });
    } else {
      // Manejo de error si no se encuentra el registro o no hay imagen
      res.status(404).send('Registro no encontrado o sin imagen');
    }
  } catch (error) {
    console.error('Error al obtener el registro de la base de datos: ' + error);
    res.status(500).send('Error al obtener el registro.');
  }
});

app.post('/update', upload.single('imagen'), async (req, res) => {
  const id = req.body.id;
  const nombre = req.body.nombre;
  const descripcion = req.body.descripcion;
  const cantidad = req.body.cantidad;
  const marca = req.body.marca;
  const precio = req.body.precio;
  let imagen = req.body.imagen; // Obtén el nombre de la imagen actual

  if (req.file) {
    // Si se seleccionó una nueva imagen, elimina la anterior
    if (imagen) {
      const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: imagen
      };
      await s3.deleteObject(params).promise();
    }
    imagen = `${Date.now()}-${req.file.originalname}`; // Asigna el nombre de la nueva imagen

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: imagen,
      Body: req.file.buffer
    };

    await s3.upload(params).promise();
  }

  try {
    await connection.promise().query(
      'UPDATE crudimg SET nombre = ?, descripcion = ?, cantidad = ?, marca = ?, precio = ?, imagen = ? WHERE id = ?',
      [nombre, descripcion, cantidad, marca, precio, imagen, id]
    );
    res.redirect('/');
  } catch (error) {
    console.error('Error al actualizar el registro en la base de datos: ' + error);
    res.status(500).send('Error al actualizar el registro.');
  }
});

app.get('/delete-all', async (req, res) => {
  try {
    const [rows] = await connection.promise().query('SELECT imagen FROM crudimg');

    const deletePromises = rows.map(async (row) => {
      const imagen = row.imagen;

      if (imagen) {
        const params = {
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: imagen
        };

        await s3.deleteObject(params).promise();
      }
    });

    await Promise.all(deletePromises);

    await connection.promise().query('DELETE FROM crudimg');

    res.redirect('/');
  } catch (error) {
    console.error('Error al eliminar las imágenes de S3 o los registros de la base de datos: ' + error);
    res.status(500).send('Error al eliminar las imágenes o los registros.');
  }
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});

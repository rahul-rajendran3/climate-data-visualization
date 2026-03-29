from flask import Flask
from flask_cors import CORS
from routes.climate_data_routes import climate_data_bp

app = Flask(__name__)
CORS(app)

app.register_blueprint(climate_data_bp)

if __name__ == "__main__":
    app.run(debug=True, port=5001)

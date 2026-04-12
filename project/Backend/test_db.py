from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27017/")
db = client["skillsbridge"]

interviews = list(db["interviews"].find({}))
for it in interviews:
    print(f"ID: {it.get('_id')}")
    print(f"Job ID: {it.get('job_id')}")
    print(f"Job Title: {it.get('job_title')}")

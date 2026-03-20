#!/usr/bin/env python3
"""Import ProPublica COMPAS recidivism dataset into Supabase."""

import csv
import os
from supabase import create_client

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://ycqvvjyplboqpmqnqenh.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

CSV_PATH = 'tmp/compas-scores-two-years.csv'

# Columns we care about (CSV has duplicates — use positional indexing)
# Header: id,name,first,last,compas_screening_date,sex,dob,age,age_cat,race,
#         juv_fel_count,decile_score(11),juv_misd_count,juv_other_count,priors_count,
#         days_b_screening_arrest,c_jail_in,c_jail_out,c_case_number,c_offense_date,
#         c_arrest_date,c_days_from_compas,c_charge_degree,c_charge_desc,is_recid,
#         r_case_number,r_charge_degree,r_days_from_arrest,r_offense_date,r_charge_desc,
#         r_jail_in,r_jail_out,violent_recid,is_violent_recid,vr_case_number,
#         vr_charge_degree,vr_offense_date,vr_charge_desc,type_of_assessment,
#         decile_score(39),score_text,screening_date,v_type_of_assessment,
#         v_decile_score,v_score_text,v_screening_date,in_custody,out_custody,
#         priors_count(48),start,end,event,two_year_recid


def parse_int(val, default=0):
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def parse_date(val):
    if not val or val.strip() == '':
        return None
    return val.strip()


def main():
    if not SUPABASE_KEY:
        print("Set SUPABASE_SERVICE_KEY env var (service role key for insert)")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Clear existing data
    sb.table('compas_defendants').delete().neq('id', -1).execute()

    records = []
    with open(CSV_PATH, 'r') as f:
        reader = csv.DictReader(f)
        # CSV has duplicate column names (decile_score, priors_count appear twice)
        # DictReader will use the last value for duplicates, which is fine for
        # priors_count but we need the COMPAS decile_score (column index 39, named score_text adjacent)
        # Actually DictReader handles this by overwriting — the second decile_score IS the right one

        for row in reader:
            records.append({
                'id': parse_int(row['id']),
                'name': row['name'].strip(),
                'first_name': row['first'].strip(),
                'last_name': row['last'].strip(),
                'sex': row['sex'].strip(),
                'dob': parse_date(row['dob']),
                'age': parse_int(row['age']),
                'age_cat': row['age_cat'].strip(),
                'race': row['race'].strip(),
                'juv_fel_count': parse_int(row['juv_fel_count']),
                'juv_misd_count': parse_int(row['juv_misd_count']),
                'juv_other_count': parse_int(row['juv_other_count']),
                'priors_count': parse_int(row['priors_count']),
                'c_charge_degree': row['c_charge_degree'].strip() or None,
                'c_charge_desc': row['c_charge_desc'].strip() or None,
                'decile_score': parse_int(row['decile_score']),
                'score_text': row['score_text'].strip(),
                'v_decile_score': parse_int(row.get('v_decile_score', '0')),
                'v_score_text': (row.get('v_score_text', '') or '').strip() or None,
                'is_recid': parse_int(row['is_recid']),
                'two_year_recid': parse_int(row['two_year_recid']),
                'r_charge_degree': (row.get('r_charge_degree', '') or '').strip() or None,
                'r_charge_desc': (row.get('r_charge_desc', '') or '').strip() or None,
                'is_violent_recid': parse_int(row.get('is_violent_recid', '0')),
                'compas_screening_date': parse_date(row['compas_screening_date']),
                'c_offense_date': parse_date(row.get('c_offense_date', '')),
            })

    print(f"Parsed {len(records)} records")

    # Batch insert (Supabase limit ~1000 per request)
    batch_size = 500
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        result = sb.table('compas_defendants').insert(batch).execute()
        print(f"  Inserted batch {i // batch_size + 1}: {len(batch)} records")

    print(f"Done. {len(records)} defendants imported.")


if __name__ == '__main__':
    main()

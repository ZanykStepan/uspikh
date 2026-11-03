CREATE OR REPLACE FUNCTION promote_groups(p_academic_year VARCHAR, p_admin_id INTEGER)
RETURNS VOID AS $$
DECLARE
    g RECORD;
    v_new_course SMALLINT;
    v_new_name   VARCHAR(30);
BEGIN
    FOR g IN SELECT * FROM groups WHERE status = 'active' LOOP
        IF g.course < 4 THEN
            v_new_course := g.course + 1;
            v_new_name := split_part(g.name,'-',1) || '-' || v_new_course
                          || substring(split_part(g.name,'-',2) FROM 2);

            UPDATE groups SET course = v_new_course, name = v_new_name, updated_at = now()
            WHERE group_id = g.group_id;

            INSERT INTO group_promotions (group_id, academic_year, from_course, to_course,
                                           new_status, old_name, new_name, promoted_by)
            VALUES (g.group_id, p_academic_year, g.course, v_new_course, 'active',
                    g.name, v_new_name, p_admin_id);
        ELSE
            v_new_name := g.name || ' (вип. ' || split_part(p_academic_year,'/',2) || ')';

            UPDATE groups SET status = 'graduated', name = v_new_name, updated_at = now()
            WHERE group_id = g.group_id;
            UPDATE users SET status = 'graduated', updated_at = now()
            WHERE group_id = g.group_id;

            INSERT INTO group_promotions (group_id, academic_year, from_course, to_course,
                                           new_status, old_name, new_name, promoted_by)
            VALUES (g.group_id, p_academic_year, g.course, NULL, 'graduated',
                    g.name, v_new_name, p_admin_id);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;


